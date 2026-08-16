import { safeHref } from './url.js';

/**
 * The tokenizer behind article bodies (ADR-0005), shared by both clients.
 *
 * Article prose is authored by whoever wrote the draft — an operator today, a
 * language model from Phase 4 — so it is untrusted input. This module answers
 * only "what did the author write", in tokens; each client renders those tokens
 * with its own primitives (`<p>`/`<strong>` on web, `<Text>` on native). No
 * stage of that pipeline produces an HTML string, so raw HTML in the source can
 * only ever come out as literal text — a stronger guarantee than sanitising a
 * full markdown pipeline's output, and why a small hand-written tokenizer beats
 * a dependency here.
 *
 * The supported subset is what news prose actually needs: headings, paragraphs,
 * lists, blockquotes, and inline emphasis/code/links. Anything else tokenizes as
 * the literal characters the author typed.
 */

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'code'; text: string }
  /** `href` has already passed {@link safeHref}; an unsafe one degrades to `text`. */
  | { type: 'link'; text: string; href: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; content: InlineToken[] }
  | { type: 'paragraph'; content: InlineToken[] }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'quote'; content: InlineToken[] };

/**
 * One pass over a line, alternating literal text and the first matching token.
 * Ordered longest-delimiter-first so `**bold**` isn't eaten by the italic rule.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/;

const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

export function parseInline(text: string): InlineToken[] {
  return text
    .split(INLINE)
    .filter((chunk) => chunk !== '')
    .map((chunk): InlineToken => {
      if (chunk.startsWith('**') && chunk.endsWith('**')) {
        return { type: 'strong', text: chunk.slice(2, -2) };
      }
      if (chunk.startsWith('*') && chunk.endsWith('*')) {
        return { type: 'em', text: chunk.slice(1, -1) };
      }
      if (chunk.startsWith('`') && chunk.endsWith('`')) {
        return { type: 'code', text: chunk.slice(1, -1) };
      }
      const link = LINK.exec(chunk);
      if (link) {
        const href = safeHref(link[2]!);
        // An unsafe scheme degrades to the label as plain text — never a live link.
        return href ? { type: 'link', text: link[1]!, href } : { type: 'text', text: link[1]! };
      }
      return { type: 'text', text: chunk };
    });
}

/** Group consecutive lines into blocks. The clients render the result. */
export function parseMarkdown(body: string): MarkdownBlock[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
    if (list) {
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        items: list.items.map((item) => parseInline(item)),
      });
      list = null;
    }
    if (quote.length > 0) {
      blocks.push({ type: 'quote', content: parseInline(quote.join(' ')) });
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
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        content: parseInline(heading[2]!),
      });
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

  return blocks;
}
