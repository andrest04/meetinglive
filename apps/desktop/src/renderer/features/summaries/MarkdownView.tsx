import { tryParseMeetingCitation } from '@vozella/core';
import { Play } from 'lucide-react';
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Icon, cn } from '../../ui';
import { formatClock } from '../session/use-audio-player';
import { decodedHref, parseBlocks, type Block, type Inline } from './markdown';

/** Lets a host take over link clicks (chat citations, external links). Absent: default navigation. */
export type LinkHandler = (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
const LinkContext = createContext<LinkHandler | undefined>(undefined);

/**
 * A citation of one transcript moment (T3): a compact chip with the time, named for where it goes.
 * The time comes from the link, not from the model's label, so the chip and the jump agree.
 */
function TimeCitation({ href, seconds }: { readonly href: string; readonly seconds: number }) {
  const onLink = useContext(LinkContext);
  const t = useT();
  const clock = formatClock(seconds);
  return (
    <a
      href={href}
      data-citation="time"
      aria-label={t('Ui_ChatCitationGoToTime', clock)}
      title={t('Ui_ChatCitationGoToTime', clock)}
      onClick={
        onLink
          ? (event) => {
              onLink(href, event);
            }
          : (event) => {
              event.preventDefault();
            }
      }
      className="mx-0.5 inline-flex items-baseline gap-1 rounded-control border border-hairline bg-paper-raised px-1.5 font-mono text-[0.8125em] leading-5 text-ink-muted no-underline transition-colors hover:border-border-control hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 forced-colors:border-[LinkText]"
    >
      <Icon icon={Play} size={12} className="self-center" />
      {clock}
    </a>
  );
}

function Link({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const onLink = useContext(LinkContext);
  const seconds = tryParseMeetingCitation(decodedHref(href))?.seconds ?? null;
  if (seconds !== null) return <TimeCitation href={href} seconds={seconds} />;
  return (
    <a
      href={href}
      title={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={
        onLink
          ? (event) => {
              onLink(href, event);
            }
          : undefined
      }
      className="underline underline-offset-2 decoration-border-control hover:decoration-ink"
    >
      {children}
    </a>
  );
}

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
          <Link key={index} href={node.href}>
            {renderInline(node.children)}
          </Link>
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
    case 'table':
      return (
        <div key={key} className="mt-3 overflow-x-auto first:mt-0">
          <table className="w-full border-collapse text-start text-ui-lg">
            <thead>
              <tr>
                {block.header.map((cell, column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-b border-hairline px-2 py-1.5 text-start font-semibold"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column} className="border-b border-hairline px-2 py-1.5 align-top">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr key={key} className="my-5 border-hairline" />;
  }
}

/**
 * Model text as a document. Built from React elements, never from an HTML string, so nothing in
 * the reply can add markup or script; links are limited to http and https. A meeting citation
 * with a moment (`?t=`) renders as a time chip; it needs the I18nProvider for its name.
 */
export function MarkdownView({
  source,
  className,
  testId,
  onLink,
}: {
  readonly source: string;
  readonly onLink?: LinkHandler;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <LinkContext.Provider value={onLink}>
      <div data-testid={testId} className={cn('text-read text-ink', className)}>
        {parseBlocks(source).map(renderBlock)}
      </div>
    </LinkContext.Provider>
  );
}
