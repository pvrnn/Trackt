import { Fragment, type ReactNode } from 'react';

/**
 * A deliberately tiny markdown renderer for article bodies (ADR-0005).
 *
 * Article prose is authored by whoever wrote the draft — an operator today, a
 * language model from Phase 4 — so it is untrusted input. This renderer builds
 * **React elements, never HTML strings**: there is no `dangerouslySetInnerHTML`
 * anywhere on the path, so raw HTML in the source can only ever come out as
 * text. That is a stronger guarantee than sanitising a full markdown pipeline's
 * output, and it is why a 90-line renderer beats pulling in a dependency here.
 *
 * The supported subset is what news prose actually needs: headings, paragraphs,
 * lists, blockquotes, and inline emphasis/code/links. Anything else renders as
 * the literal characters the author typed.
 */

/** Only these schemes may become an anchor. `javascript:` and friends stay text. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url, 'https://example.invalid');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * One pass over a line, alternating literal text and the first matching token.
 * Ordered longest-delimiter-first so `**bold**` isn't eaten by the italic rule.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((chunk, index) => {
    const key = `${keyPrefix}-${index}`;
    if (chunk.startsWith('**') && chunk.endsWith('**')) {
      return <strong key={key}>{chunk.slice(2, -2)}</strong>;
    }
    if (chunk.startsWith('*') && chunk.endsWith('*')) {
      return <em key={key}>{chunk.slice(1, -1)}</em>;
    }
    if (chunk.startsWith('`') && chunk.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-glass-well px-1.5 py-0.5 font-label text-[0.9em]">
          {chunk.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(chunk);
    if (link) {
      const href = safeHref(link[2]!);
      // An unsafe scheme degrades to the label as plain text — never a live link.
      if (!href) return <Fragment key={key}>{link[1]}</Fragment>;
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          // noreferrer as well as noopener: outbound links from model-authored
          // prose should not leak this instance's URLs as referrers.
          rel="noopener noreferrer nofollow"
          className="text-pink underline underline-offset-2 hover:brightness-115"
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={key}>{chunk}</Fragment>;
  });
}

/** Group consecutive lines into blocks, then render each. */
export function Markdown({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      const text = paragraph.join(' ');
      blocks.push(
        <p key={`p-${blocks.length}`} className="text-[15px] leading-[1.75] text-muted">
          {renderInline(text, `p-${blocks.length}`)}
        </p>,
      );
      paragraph = [];
    }
    if (list) {
      const Tag = list.ordered ? 'ol' : 'ul';
      const key = `l-${blocks.length}`;
      blocks.push(
        <Tag
          key={key}
          className={`flex list-outside flex-col gap-2 pl-5 text-[15px] leading-[1.75] text-muted ${
            list.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {list.items.map((item, index) => (
            <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
          ))}
        </Tag>,
      );
      list = null;
    }
    if (quote.length > 0) {
      const key = `q-${blocks.length}`;
      blocks.push(
        <blockquote
          key={key}
          className="border-l-2 border-pink pl-4 text-[15px] leading-[1.75] text-dim italic"
        >
          {renderInline(quote.join(' '), key)}
        </blockquote>,
      );
      quote = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      flush();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      const key = `h-${blocks.length}`;
      const content = renderInline(heading[2]!, key);
      const sizes = ['text-[26px]', 'text-[21px]', 'text-[17px]'];
      const className = `font-display uppercase ${sizes[level - 1]} mt-2`;
      blocks.push(
        level === 1 ? (
          <h2 key={key} className={className}>
            {content}
          </h2>
        ) : level === 2 ? (
          <h3 key={key} className={className}>
            {content}
          </h3>
        ) : (
          <h4 key={key} className={className}>
            {content}
          </h4>
        ),
      );
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      const ordered = numbered !== null;
      const item = (bullet ?? numbered)![1]!;
      // A switch between list styles starts a new list rather than mixing them.
      if (list && list.ordered !== ordered) flush();
      if (paragraph.length > 0 || quote.length > 0) flush();
      list ??= { ordered, items: [] };
      list.items.push(item);
      continue;
    }

    const quoted = /^>\s?(.*)$/.exec(trimmed);
    if (quoted) {
      if (paragraph.length > 0 || list) flush();
      quote.push(quoted[1]!);
      continue;
    }

    if (list || quote.length > 0) flush();
    paragraph.push(trimmed);
  }
  flush();

  return <div className="flex flex-col gap-4">{blocks}</div>;
}
