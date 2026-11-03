import { ArrowDown, Copy, Mic, Star } from 'lucide-react';
import { memo, useId, useMemo, useRef } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Badge, Button, Icon, IconButton, Notice, cn } from '../../ui';
import { liveLinesFrom, splitLines } from '../transcription/live-lines';
import { useFollowScroll } from './use-follow-scroll';
import { useHeldValue, useReadingHold } from './use-live-text';

export interface LiveCanvasProps {
  readonly heading: string;
  /** The LIVE badge: recording and not paused. */
  readonly live: boolean;
  /** The canvas text with the highlight stars already applied (main caches the pass, B-22). */
  readonly text: string;
  /** Lines from the top that the engine will not rewrite; `Infinity` for a finished text. */
  readonly committedLines: number;
  /** Shown instead of the hint when the text is empty. */
  readonly emptyText: string;
  /** "Highlighted 00:12.30", or null. Announced politely. */
  readonly highlightFeedback: string | null;
  /** The status caption of the take; the container leaves it out when it is an error. */
  readonly statusText: string | null;
  /** The "Copied" bar is showing. */
  readonly copied: boolean;
  /** A text Copy button in the heading row, for the finished transcript (spec 2.6). */
  readonly onCopy: (() => void) | null;
  /** Lets e2e tell the live surface from the finished one. */
  readonly surfaceTestId?: string;
  readonly className?: string;
}

interface RowProps {
  readonly kind: 'committed' | 'interim';
  readonly start: string | null;
  readonly speaker: number | null;
  readonly text: string;
  readonly starred: boolean;
  readonly starLabel: string;
}

/**
 * One transcript line. Every prop is a primitive, so `memo` skips the lines that did not change:
 * an update re-renders the interim tail and the new line, never the whole meeting (item 111).
 */
const Row = memo(function Row({ kind, start, speaker, text, starred, starLabel }: RowProps) {
  return (
    <li
      className={cn(
        'grid grid-cols-[1rem_4.5rem_minmax(0,1fr)] items-baseline gap-x-2',
        kind === 'interim' ? 'text-ink-muted' : 'text-ink',
      )}
    >
      <span className="flex justify-center self-start pt-[7px]">
        {starred ? (
          <>
            <Icon icon={Star} size={12} className="fill-current" />
            <span className="sr-only">{starLabel}</span>
          </>
        ) : null}
      </span>
      <span className="font-mono text-ui text-ink-faint select-none">{start ?? ''}</span>
      <span className="break-words whitespace-pre-wrap">
        {speaker === null ? null : (
          <span className="me-2 font-mono text-ui text-ink-muted">{`S${String(speaker)}`}</span>
        )}
        {text}
      </span>
    </li>
  );
});

const HeaderRow = memo(function HeaderRow({ text }: { readonly text: string }) {
  return <li className="font-mono text-ui text-ink-faint">{text}</li>;
});

/** Lines per block: an update re-renders the last block, never the whole meeting. */
export const BLOCK_LINES = 50;

interface BlockProps {
  readonly text: string;
  /** How many of the block's lines are committed. */
  readonly committed: number;
  readonly starLabel: string;
}

/**
 * Fifty lines of the transcript, parsed and drawn together. Its props are two strings and two
 * numbers, so memo skips every block whose text did not change: only the block holding the
 * interim tail renders when text arrives (item 111).
 */
const Block = memo(function Block({ text, committed, starLabel }: BlockProps) {
  const lines = useMemo(() => liveLinesFrom(text, committed), [text, committed]);
  return lines.map((line, index) =>
    line.kind === 'header' ? (
      <HeaderRow key={index} text={line.text} />
    ) : (
      <Row
        key={index}
        kind={line.kind}
        start={line.start}
        speaker={line.speaker}
        text={line.text}
        starred={line.starred}
        starLabel={starLabel}
      />
    ),
  );
});

interface BlockSpec {
  readonly text: string;
  readonly committed: number;
}

/** Splits the text into blocks of whole lines; committedLines counts from the top. */
export function toBlocks(text: string, committedLines: number): BlockSpec[] {
  const lines = splitLines(text);
  const blocks: BlockSpec[] = [];
  for (let start = 0; start < lines.length; start += BLOCK_LINES) {
    const slice = lines.slice(start, start + BLOCK_LINES);
    blocks.push({
      text: slice.join('\n'),
      committed: Math.min(slice.length, Math.max(0, committedLines - start)),
    });
  }
  return blocks;
}

/**
 * The transcript surface (spec 2.7): a heading row, then a bordered scroll area with the text at
 * 16 px / 26 px, content capped at 760. Calm by construction: committed lines are memoized by
 * index, the display holds still while the reader has focus or a selection in it (item 106), the
 * view follows the end until the reader scrolls away (item 107), and nothing moves layout.
 */
export function LiveCanvas({
  heading,
  live,
  text,
  committedLines,
  emptyText,
  highlightFeedback,
  statusText,
  copied,
  onCopy,
  surfaceTestId = 'live-transcript',
  className,
}: LiveCanvasProps) {
  const t = useT();
  const headingId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const hold = useReadingHold(scroller);

  const incoming = useMemo(() => ({ text, committedLines }), [text, committedLines]);
  const shown = useHeldValue(incoming, hold.held);

  const blocks = useMemo(
    () => toBlocks(shown.text, shown.committedLines),
    [shown.text, shown.committedLines],
  );
  const follow = useFollowScroll(scroller, shown.text);
  const starLabel = t('Record_Highlight');

  return (
    <div
      data-testid="live-canvas"
      className={cn('relative flex min-h-0 flex-col gap-3', className)}
    >
      <div className="flex min-h-7 items-center gap-3">
        <h2 id={headingId} className="text-read-lg font-semibold text-ink">
          {heading}
        </h2>
        {live ? (
          <Badge tone="live">
            <span data-testid="live-badge">{t('RecordPage_LiveBadge.Text')}</span>
          </Badge>
        ) : null}
        <div className="ms-auto flex min-w-0 items-center gap-3">
          <p
            role="status"
            aria-live="polite"
            data-testid="highlight-feedback"
            className="max-w-[360px] truncate font-mono text-ui text-ink"
          >
            {highlightFeedback ?? ''}
          </p>
          {statusText ? (
            <p
              className="max-w-[360px] truncate text-ui text-ink-muted"
              data-testid="recording-status"
            >
              {statusText}
            </p>
          ) : null}
          {onCopy && text !== '' ? (
            <Button size="sm" icon={Copy} onClick={onCopy} data-testid="BtnCopyCanvas">
              {t('RecordPage_Copy.Content')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          tabIndex={0}
          role="region"
          aria-labelledby={headingId}
          data-testid={surfaceTestId}
          onScroll={follow.onScroll}
          onFocus={hold.onFocus}
          onBlur={hold.onBlur}
          className={cn(
            'h-full min-h-60 overflow-y-auto rounded-control border border-hairline px-6 py-5 select-text',
            'text-read-lg [overflow-anchor:none]',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
          )}
        >
          <div className="mx-auto max-w-[760px]">
            {blocks.length === 0 ? (
              <div
                className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-ink-muted"
                data-testid="canvas-empty"
              >
                <Icon icon={Mic} size={20} />
                <p className="max-w-[480px] text-read">{emptyText}</p>
              </div>
            ) : (
              <ol className="flex flex-col gap-1" data-testid="canvas-lines">
                {blocks.map((block, index) => (
                  <Block
                    key={index}
                    text={block.text}
                    committed={block.committed}
                    starLabel={starLabel}
                  />
                ))}
              </ol>
            )}
          </div>
        </div>

        {follow.stuck ? null : (
          <IconButton
            label={t('RecordPage_JumpToLatest')}
            icon={ArrowDown}
            variant="secondary"
            data-testid="BtnJumpToLatest"
            onClick={follow.jumpToLatest}
            className="absolute right-5 bottom-4 bg-paper-raised"
          />
        )}

        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute top-3 right-3 max-w-80"
        >
          {copied ? (
            <Notice tone="info" className="pointer-events-auto bg-paper">
              <p className="font-medium">{t('RecordPage_CopyConfirmation.Title')}</p>
              <p className="text-ui text-ink-muted">{t('RecordPage_CopyConfirmation.Message')}</p>
            </Notice>
          ) : null}
        </div>
      </div>
    </div>
  );
}
