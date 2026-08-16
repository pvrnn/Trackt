import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../src/markdown.js';

/**
 * The tokenizer's contract, and specifically the security half of it: no branch
 * may ever emit markup, and a link's `href` must have passed `safeHref`.
 */

describe('parseInline', () => {
  it('tokenizes emphasis, code and links', () => {
    expect(parseInline('a **b** c *d* `e` [f](https://x.test/g)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', text: 'b' },
      { type: 'text', text: ' c ' },
      { type: 'em', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'e' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'f', href: 'https://x.test/g' },
    ]);
  });

  it('prefers bold over italic on the same run', () => {
    expect(parseInline('**bold**')).toEqual([{ type: 'strong', text: 'bold' }]);
  });

  it('degrades an unsafe link to its label as plain text', () => {
    // The target's own `)` closes the link early, so the trailing paren falls
    // through as literal text — the point is that no `link` token survives.
    expect(parseInline('[click](javascript:alert(1))')).toEqual([
      { type: 'text', text: 'click' },
      { type: 'text', text: ')' },
    ]);
  });

  it('never emits markup for raw HTML — it is literal text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('groups paragraphs on blank lines and joins wrapped lines', () => {
    expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'one two' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
    ]);
  });

  it('reads the three heading levels', () => {
    expect(parseMarkdown('# a\n## b\n### c').map((block) => block)).toEqual([
      { type: 'heading', level: 1, content: [{ type: 'text', text: 'a' }] },
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'b' }] },
      { type: 'heading', level: 3, content: [{ type: 'text', text: 'c' }] },
    ]);
  });

  it('starts a new list when the marker style switches', () => {
    expect(parseMarkdown('- a\n- b\n1. c')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]],
      },
      { type: 'list', ordered: true, items: [[{ type: 'text', text: 'c' }]] },
    ]);
  });

  it('collects a blockquote and ends it at the next paragraph', () => {
    expect(parseMarkdown('> quoted\n> more\n\nafter')).toEqual([
      { type: 'quote', content: [{ type: 'text', text: 'quoted more' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
    ]);
  });

  it('normalises CRLF', () => {
    expect(parseMarkdown('a\r\n\r\nb')).toHaveLength(2);
  });
});
