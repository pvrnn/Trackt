/**
 * `node scripts/catalog-research/report.mjs`
 *
 * Human-readable change log for the whole pass, built from the validated
 * result files. Writes into `apps/catalog/seed/research/`:
 *
 *   changes.html    the browsable view — everything, grouped by seed, with a filter box
 *   changes.md      the same content as markdown, for an editor or `less`
 *   links.csv       one row per edge (from → to, type, confidence, evidence)
 *   edits.csv       one row per metadata edit (field, old value, new value, source)
 *   rejected.csv    one row per rejection, with the reason (the audit trail for
 *                   what was deliberately NOT linked)
 *
 * Nothing is applied here; it only reads results and reports what a merge does.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SEED_DIR = resolve('apps/catalog/seed');
const RESEARCH_DIR = resolve(SEED_DIR, 'research');
const SEEDS = [
  'top-anime-anilist.json',
  'top-manga-anilist.json',
  'top-games-igdb.json',
  'top-movies-tmdb.json',
  'top-series-tmdb.json',
];
const CARRIER = 'top-series-tmdb.json';
// The replayable patch lives with the tooling, not with the seeds: it has to
// survive `rm -rf apps/catalog/seed` and a full re-scrape.
const PATCH_PATH = resolve('scripts/catalog-research/research-patch.json');

const csv = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const line = (cells) => cells.map(csv).join(',');
const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const pairKey = (a, b) => [a, b].sort().join('|');

async function main() {
  const rows = new Map();
  const homes = new Map();
  // The `was` column must come from BEFORE the merge. Reading it off the live
  // seeds showed every edit as `x → x` once the pass had been applied.
  const baselineRows = new Map();
  const entries = await readdir(SEED_DIR);
  for (const name of SEEDS) {
    const file = JSON.parse(await readFile(resolve(SEED_DIR, name), 'utf8'));
    for (const row of file.catalog_media) {
      rows.set(row.id, row);
      if (!homes.has(row.id)) homes.set(row.id, []);
      homes.get(row.id).push(name);
    }
    const backup = entries
      .filter((entry) => entry.startsWith(`${name}.pre-research-`) && entry.endsWith('.bak'))
      .sort()[0];
    if (!backup) continue;
    const before = JSON.parse(await readFile(resolve(SEED_DIR, backup), 'utf8'));
    for (const row of before.catalog_media) baselineRows.set(row.id, row);
  }

  const files = (await readdir(resolve(RESEARCH_DIR, 'results')))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const links = [];
  const edits = [];
  const editSlots = new Map();
  let duplicateProposals = 0;
  let noOpProposals = 0;
  const rejected = [];
  const duplicates = [];
  const claimed = new Set();

  for (const file of files) {
    const result = JSON.parse(await readFile(resolve(RESEARCH_DIR, 'results', file), 'utf8'));
    for (const verdict of result.verdicts) {
      if (verdict.duplicate)
        duplicates.push({ batch: result.batch, n: verdict.n, ...verdict.duplicate });
      for (const edit of verdict.metadata ?? []) {
        const row = rows.get(edit.id);
        const slot = `${edit.id}|${edit.path}`;
        const size = (value) => (Array.isArray(value) ? value.length : String(value ?? '').length);
        const richer = edit.path === 'description' || Array.isArray(edit.to);
        const previous = editSlots.get(slot);
        if (previous && (!richer || size(previous.to) >= size(edit.to))) {
          duplicateProposals++;
          continue;
        }
        if (previous) duplicateProposals++;
        editSlots.set(slot, edit);
        const before = edit.path
          .split('.')
          .reduce(
            (value, part) => (value == null ? value : value[part]),
            baselineRows.get(edit.id) ?? row,
          );
        // A proposal the seed already agreed with is not a change; `merge`
        // skips it too, and listing it as `x → x` reads like a mistake.
        if (JSON.stringify(before ?? null) === JSON.stringify(edit.to)) {
          noOpProposals++;
          continue;
        }
        edits.push({
          batch: result.batch,
          n: verdict.n,
          id: edit.id,
          title: row ? `${row.title} (${row.year ?? '—'})` : '?',
          kind: row?.kind ?? '?',
          seeds: (homes.get(edit.id) ?? []).join(' + '),
          path: edit.path,
          from: JSON.stringify(before ?? null),
          to: JSON.stringify(edit.to),
          source: edit.source,
        });
      }
      if (verdict.verdict !== 'linked') {
        rejected.push({
          batch: result.batch,
          n: verdict.n,
          left: rows.get(verdict.link?.fromId)?.title ?? '',
          reason: verdict.reason ?? '',
          duplicate: verdict.duplicate ? 'yes' : '',
          evidence: (verdict.evidence ?? []).join(' '),
        });
        continue;
      }
      const { fromId, toId, type, confidence, source } = verdict.link;
      if (confidence === 'low') continue;
      const key = pairKey(fromId, toId);
      if (claimed.has(`${key}|${type}`)) continue;
      claimed.add(`${key}|${type}`);
      const both = (homes.get(fromId) ?? []).filter((name) => homes.get(toId)?.includes(name));
      const from = rows.get(fromId);
      const to = rows.get(toId);
      links.push({
        batch: result.batch,
        n: verdict.n,
        type,
        confidence: confidence ?? 'high',
        fromId,
        from: from ? `${from.kind} · ${from.title} (${from.year ?? '—'})` : fromId,
        toId,
        to: to ? `${to.kind} · ${to.title} (${to.year ?? '—'})` : toId,
        seeds: (both.length ? both : [CARRIER]).join(' + '),
        source,
        reason: verdict.reason,
      });
    }
  }

  // One entry per field becomes one reshaped proposal per field: when a richer
  // later audit replaced an earlier one it is the one pushed last, so keeping
  // the last entry per slot drops the superseded value from the log and patch.
  const finalEdits = new Map();
  for (const edit of edits) finalEdits.set(`${edit.id}|${edit.path}`, edit);
  edits.length = 0;
  edits.push(...finalEdits.values());

  await writeFile(
    resolve(RESEARCH_DIR, 'links.csv'),
    [
      line(['batch', 'n', 'type', 'confidence', 'from', 'to', 'seeds', 'source', 'reason']),
      ...links.map((l) =>
        line([l.batch, l.n, l.type, l.confidence, l.from, l.to, l.seeds, l.source, l.reason]),
      ),
    ].join('\n'),
  );
  await writeFile(
    resolve(RESEARCH_DIR, 'edits.csv'),
    [
      line(['batch', 'n', 'id', 'title', 'kind', 'seeds', 'path', 'from', 'to', 'source']),
      ...edits.map((e) =>
        line([e.batch, e.n, e.id, e.title, e.kind, e.seeds, e.path, e.from, e.to, e.source]),
      ),
    ].join('\n'),
  );
  await writeFile(
    resolve(RESEARCH_DIR, 'rejected.csv'),
    [
      line(['batch', 'n', 'reason', 'duplicate', 'evidence']),
      ...rejected.map((r) => line([r.batch, r.n, r.reason, r.duplicate, r.evidence])),
    ].join('\n'),
  );
  if (duplicates.length) {
    await writeFile(resolve(RESEARCH_DIR, 'duplicates.json'), JSON.stringify(duplicates, null, 1));
  }

  const byType = {};
  const byConfidence = {};
  for (const link of links) {
    byType[link.type] = (byType[link.type] ?? 0) + 1;
    byConfidence[link.confidence] = (byConfidence[link.confidence] ?? 0) + 1;
  }
  const bySeed = new Map(SEEDS.map((name) => [name, { links: [], edits: [] }]));
  for (const link of links) {
    for (const seed of link.seeds.split(' + ')) bySeed.get(seed)?.links.push(link);
  }
  for (const edit of edits) {
    for (const seed of edit.seeds.split(' + ')) bySeed.get(seed)?.edits.push(edit);
  }

  const summary = {
    batches: files.length,
    candidates: 15_550,
    edges: links.length,
    byType,
    byConfidence,
    edits: edits.length,
    duplicateProposals,
    noOpProposals,
    rejections: rejected.length,
    duplicates: duplicates.length,
  };

  const md = [
    '# Catalog research pass — change log',
    '',
    `Generated ${new Date().toISOString()} from ${files.length} validated batch results.`,
    'Nothing here is applied by this file; `merge.mjs` is what writes the seeds.',
    '',
    '| | |',
    '|---|---|',
    `| batches | **${summary.batches} / 156** |`,
    `| edges | **${summary.edges}** (${Object.entries(byType)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}) |`,
    `| confidence | ${Object.entries(byConfidence)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')} |`,
    `| metadata edits | **${summary.edits}** |`,
    `| rejections | **${summary.rejections}** |`,
    `| duplicates reported | **${summary.duplicates}** |`,
    '',
    'Per-seed detail below. Full machine-readable lists: `links.csv`, `edits.csv`, `rejected.csv`.',
    'Open `changes.html` to filter the same content by title.',
    '',
  ];
  for (const [seed, bucket] of bySeed) {
    md.push(`## ${seed} — ${bucket.links.length} edges, ${bucket.edits.length} edits`, '');
    if (bucket.links.length) {
      md.push(
        '### Relations',
        '',
        '| type | from | | to | conf. | source |',
        '|---|---|---|---|---|---|',
      );
      for (const link of bucket.links) {
        md.push(
          `| ${link.type} | ${link.from} | → | ${link.to} | ${link.confidence} | ${link.source} |`,
        );
      }
      md.push('');
    }
    if (bucket.edits.length) {
      md.push(
        '### Metadata',
        '',
        '| title | field | was | now | source |',
        '|---|---|---|---|---|',
      );
      for (const edit of bucket.edits) {
        md.push(`| ${edit.title} | ${edit.path} | ${edit.from} | ${edit.to} | ${edit.source} |`);
      }
      md.push('');
    }
  }
  await writeFile(resolve(RESEARCH_DIR, 'changes.md'), md.join('\n'));

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Catalog research pass — ${summary.edges} edges, ${summary.edits} edits</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; opacity: .7; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
  .stat { border: 1px solid #8884; border-radius: 10px; padding: 8px 14px; }
  .stat b { display: block; font-size: 20px; }
  .stat span { font-size: 12px; opacity: .7; text-transform: uppercase; letter-spacing: .06em; }
  input[type=search] { width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit;
    border: 1px solid #8886; border-radius: 10px; margin-bottom: 18px; background: transparent; }
  h2 { font-size: 17px; margin: 28px 0 6px; }
  h2 small { font-weight: 400; opacity: .6; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #8882; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .6; font-weight: 600; }
  td.type { white-space: nowrap; font-weight: 600; }
  td.was { opacity: .55; text-decoration: line-through; max-width: 320px; }
  td.now { max-width: 320px; }
  code { font: 12px ui-monospace, monospace; }
  a { color: inherit; }
  .empty { opacity: .6; font-style: italic; }
</style>
<h1>Catalog research pass</h1>
<p class="sub">${esc(String(new Date().toISOString().slice(0, 10)))} — ${files.length} validated batches of 100 cross-kind candidates. Nothing on this page was inferred: every row cites the source it was read from.</p>
<div class="stats">
  <div class="stat"><b>${links.length}</b><span>edges</span></div>
  <div class="stat"><b>${edits.length}</b><span>metadata edits</span></div>
  <div class="stat"><b>${rejected.length}</b><span>rejected pairs</span></div>
  <div class="stat"><b>${duplicates.length}</b><span>duplicates reported</span></div>
</div>
<input type="search" placeholder="filter by title, kind, field, source…" oninput="filter(this.value)">
${[...bySeed.entries()]
  .map(
    ([seed, bucket]) => `
<h2>${esc(seed)} <small>— ${bucket.links.length} edges, ${bucket.edits.length} edits</small></h2>
${
  bucket.links.length
    ? `<table>
<thead><tr><th>type</th><th>from</th><th></th><th>to</th><th>conf.</th><th>source</th></tr></thead>
<tbody>
${bucket.links
  .map(
    (l) =>
      `<tr class="row"><td class="type">${esc(l.type)}</td><td>${esc(l.from)}</td><td>→</td><td>${esc(l.to)}</td><td>${esc(l.confidence)}</td><td><a href="${esc(l.source)}">${esc(new URL(l.source).hostname)}</a></td></tr>`,
  )
  .join('\n')}
</tbody></table>`
    : '<p class="empty">no edges land here</p>'
}
${
  bucket.edits.length
    ? `<table>
<thead><tr><th>title</th><th>field</th><th>was</th><th>now</th><th>source</th></tr></thead>
<tbody>
${bucket.edits
  .map(
    (e) =>
      `<tr class="row"><td>${esc(e.title)}</td><td><code>${esc(e.path)}</code></td><td class="was">${esc(e.from)}</td><td class="now">${esc(e.to)}</td><td><a href="${esc(e.source)}">${esc(new URL(e.source).hostname)}</a></td></tr>`,
  )
  .join('\n')}
</tbody></table>`
    : ''
}
`,
  )
  .join('')}
<script>
function filter(value) {
  const needle = value.trim().toLowerCase();
  for (const row of document.querySelectorAll('tr.row')) {
    row.style.display = !needle || row.textContent.toLowerCase().includes(needle) ? '' : 'none';
  }
}
</script>
`;
  await writeFile(resolve(RESEARCH_DIR, 'changes.html'), html);

  // A replayable patch: keyed by canonical id (stable across a re-scrape), with
  // the pre-pass value alongside each edit so the replayer can tell "this field
  // still holds what we corrected" from "the new scrape changed it".
  const patch = {
    generatedAt: new Date().toISOString(),
    source: `catalog-research pass, ${files.length} batches`,
    keyedBy: 'canonical media id (UUIDv5) — stable across re-scrapes',
    edges: links
      .map((l) => ({
        fromId: l.fromId,
        toId: l.toId,
        type: l.type,
        confidence: l.confidence,
        source: l.source,
        reason: l.reason,
        batch: l.batch,
        n: l.n,
      }))
      .sort((a, b) =>
        `${a.fromId}${a.toId}${a.type}`.localeCompare(`${b.fromId}${b.toId}${b.type}`),
      ),
    edits: edits
      .map((e) => ({
        id: e.id,
        path: e.path,
        from: JSON.parse(e.from),
        to: JSON.parse(e.to),
        source: e.source,
        batch: e.batch,
        n: e.n,
      }))
      .sort((a, b) => `${a.id}${a.path}`.localeCompare(`${b.id}${b.path}`)),
    heldBack: {
      lowConfidence: JSON.parse(
        await readFile(resolve(RESEARCH_DIR, 'low-confidence.json'), 'utf8').catch(() => '[]'),
      ),
      duplicates,
    },
    stats: summary,
  };
  await writeFile(resolve(PATCH_PATH), JSON.stringify(patch, null, 1));

  console.log(summary);
  console.log(
    'wrote research-patch.json, changes.html, changes.md, links.csv, edits.csv, rejected.csv',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
