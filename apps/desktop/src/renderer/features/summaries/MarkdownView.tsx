import type { ReactNode } from 'react';
import { cn } from '../../ui';
import { parseBlocks, type Block, type Inline } from './markdown';

function renderInline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'code':
        return (
          <code
            key={index}
            className="rounded-control bg-hover px-1 py-px font-mono text-[0.9em] forced-colors:border forced-colors:border-[CanvasText]"
          >
            {node.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={index} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        );
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>;
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 decoration-border-control hover:decoration-ink"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

const headingClass: Record<number, string> = {
  1: 'mt-7 text-heading font-semibold tracking-[-0.01em]',
  2: 'mt-7 text-heading font-semibold tracking-[-0.01em]',
  3: 'mt-6 text-read-lg font-semibold',
  4: 'mt-5 text-read font-semibold',
  5: 'mt-5 text-read font-semibold',
  6: 'mt-5 text-read font-medium text-ink-muted',
};

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${String(Math.min(block.level + 1, 6))}` as 'h2';
      return (
        <Tag key={key} className={cn(headingClass[block.level], 'first:mt-0')}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="mt-3 first:mt-0">
          {renderInline(block.children)}
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={cn(
            'mt-3 ps-5 first:mt-0',
            block.ordered ? 'list-decimal' : 'list-disc',
            'marker:text-ink-faint',
          )}
        >
          {block.items.map((item, index) => (
            <li key={index} className="mt-1.5 ps-1 first:mt-0">
              {renderInline(item.children)}
              {item.nested.map(renderBlock)}
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote key={key} className="mt-3 border-s-2 border-border-control ps-4 text-ink-muted">
          {block.children.map(renderBlock)}
        </blockquote>
      );
    case 'code':
      return (
        <pre
          key={key}
          className="mt-3 overflow-x-auto rounded-control border border-hairline bg-paper-raised p-3 font-mono text-ui"
        >
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr key={key} className="my-5 border-hairline" />;
  }
}

/**
 * Model text as a document. Built from React elements, never from an HTML string, so nothing in
 * the reply can add markup or script; links are limited to http and https.
 */
export function MarkdownView({
  source,
  className,
  testId,
}: {
  readonly source: string;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <div data-testid={testId} className={cn('text-read text-ink', className)}>
      {parseBlocks(source).map(renderBlock)}
    </div>
  );
}
