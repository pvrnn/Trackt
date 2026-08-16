import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type InlineToken, type MarkdownBlock } from '@trackt/client';

/**
 * The web half of the article renderer (ADR-0005).
 *
 * The tokenizer moved to `@trackt/client` when the mobile client needed the same
 * prose — what stays here is only the mapping from token to element. The
 * guarantee it exists for is unchanged and structural: this builds **React
 * elements, never HTML strings**, so there is no `dangerouslySetInnerHTML` on
 * the path and raw HTML in a model-authored body can only come out as text.
 */

function renderInline(tokens: InlineToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case 'strong':
        return <strong key={key}>{token.text}</strong>;
      case 'em':
        return <em key={key}>{token.text}</em>;
      case 'code':
        return (
          <code key={key} className="rounded bg-glass-well px-1.5 py-0.5 font-label text-[0.9em]">
            {token.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={token.href}
            target="_blank"
            // noreferrer as well as noopener: outbound links from model-authored
            // prose should not leak this instance's URLs as referrers.
            rel="noopener noreferrer nofollow"
            className="text-pink underline underline-offset-2 hover:brightness-115"
          >
            {token.text}
          </a>
        );
      case 'text':
        return <Fragment key={key}>{token.text}</Fragment>;
    }
  });
}

const HEADING_SIZES = ['text-[26px]', 'text-[21px]', 'text-[17px]'];

function renderBlock(block: MarkdownBlock, key: string): ReactNode {
  switch (block.type) {
    case 'heading': {
      const className = `font-heading uppercase ${HEADING_SIZES[block.level - 1]} mt-2`;
      const content = renderInline(block.content, key);
      // h1 is the page's own title, so an article heading starts at h2.
      if (block.level === 1)
        return (
          <h2 key={key} className={className}>
            {content}
          </h2>
        );
      if (block.level === 2)
        return (
          <h3 key={key} className={className}>
            {content}
          </h3>
        );
      return (
        <h4 key={key} className={className}>
          {content}
        </h4>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="text-[15px] leading-[1.75] text-muted">
          {renderInline(block.content, key)}
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={`flex list-outside flex-col gap-2 pl-5 text-[15px] leading-[1.75] text-muted ${
            block.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote
          key={key}
          className="border-l-2 border-pink pl-4 text-[15px] leading-[1.75] text-dim italic"
        >
          {renderInline(block.content, key)}
        </blockquote>
      );
  }
}

export function Markdown({ body }: { body: string }) {
  return (
    <div className="flex flex-col gap-4">
      {parseMarkdown(body).map((block, index) => renderBlock(block, `b-${index}`))}
    </div>
  );
}
