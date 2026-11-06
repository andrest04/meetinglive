import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Notice, SkeletonText, cn, useReducedMotion } from '../../ui';
import {
  hasTranscriptContent,
  lineAtSeconds,
  toLines,
  type TranscriptLine,
} from './transcript-lines';
import { completeTranscriptReveal, usePendingTranscriptReveal } from './transcript-reveal';
import { AudioBar } from './AudioBar';
import { audioUrl, useAudioPlayer } from './use-audio-player';
import { useTranscript } from './use-transcript';

/** What a tab gives the Copy button: its text, or null when it has nothing to copy. */
export type CopySource = () => Promise<string | null>;
export type CopySourceRef = RefObject<CopySource | null>;

const partClass = {
  star: 'text-ink-muted',
  stamp: 'font-mono text-[0.8125em] text-ink-muted',
  text: '',
} as const;

/** Off-screen lines skip layout and paint, so a multi-megabyte transcript stays responsive (B20). */
/** How long a revealed line stays highlighted (T3). */
export const REVEAL_HIGHLIGHT_MS = 2400;

const Line = memo(function Line({
  line,
  onSeek,
  revealed = false,
  highlighted = false,
}: {
  readonly line: TranscriptLine;
  /** Set when the audio plays and the line has a stamp: a click starts playback there. */
  readonly onSeek: ((seconds: number) => void) | undefined;
  /** The line a chat citation opened: it can take focus. */
  readonly revealed?: boolean;
  /** Briefly true after a reveal. */
  readonly highlighted?: boolean;
}) {
  const start = line.startSeconds;
  const seekable = onSeek !== undefined && start !== null;
  return (
    <p
      data-line-key={line.key}
      data-highlighted={highlighted ? 'true' : undefined}
      tabIndex={revealed ? -1 : undefined}
      onClick={
        seekable
          ? (event) => {
              // Selecting text (drag, double click) must not seek or interrupt playback.
              if (event.detail > 1 || !window.getSelection()?.isCollapsed) return;
              onSeek(start);
            }
          : undefined
      }
      className={cn(
        seekable && 'cursor-pointer hover:bg-hover',
        '[content-visibility:auto] [contain-intrinsic-size:auto_2rem] min-h-6 pb-1.5 whitespace-pre-wrap break-words ps-3 -ms-3',
        line.starred && 'border-s-2 border-ink ps-[10px]',
        'rounded-control transition-colors duration-700 motion-reduce:transition-none focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1',
        highlighted && 'bg-pressed duration-150',
      )}
    >
      {line.blank ? (
        <br />
      ) : (
        line.parts.map((part, index) => (
          <span key={index} className={partClass[part.kind]}>
            {part.text}
          </span>
        ))
      )}
    </p>
  );
});

/**
 * Transcript tab (spec 2.6): the stored text, line by line, as written. Stamps are muted and
 * starred lines get a quiet marker, but every character stays in the DOM, so selecting and
 * copying gives back the stored transcript.
 */
export function TranscriptTab({
  meetingId,
  copySourceRef,
  hasAudio = false,
}: {
  readonly meetingId: string;
  readonly copySourceRef: CopySourceRef;
  /** The meeting has saved audio: show the player and let stamped lines seek it. */
  readonly hasAudio?: boolean;
}) {
  const t = useT();
  const model = useTranscript(meetingId);
  const displayed = useRef('');
  displayed.current = model.text;

  useEffect(() => {
    // Copy takes what is displayed now, also while a re-transcription replaces it.
    copySourceRef.current = () =>
      Promise.resolve(hasTranscriptContent(displayed.current) ? displayed.current : null);
    return () => {
      copySourceRef.current = null;
    };
  }, [copySourceRef, meetingId]);

  const lines = useMemo(() => toLines(model.text), [model.text]);
  const player = useAudioPlayer();
  const { playFrom } = player;
  const audioOn = hasAudio && !player.failed;
  const onSeek = useCallback(
    (seconds: number) => {
      playFrom(seconds);
    },
    [playFrom],
  );

  // T3: a chat time citation asked to show a moment. Shown once the text is here, then dropped.
  const reveal = usePendingTranscriptReveal(meetingId);
  const ready = model.phase !== 'loading' && model.phase !== 'error';
  const handled = useRef<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const still = useReducedMotion();
  const [revealed, setRevealed] = useState<{ key: number; on: boolean; nonce: number } | null>(
    null,
  );
  useEffect(() => {
    if (reveal === null || !ready || handled.current === reveal.nonce) return;
    handled.current = reveal.nonce;
    completeTranscriptReveal(reveal.nonce);
    const line = lineAtSeconds(lines, reveal.seconds);
    if (line === null) {
      boxRef.current?.focus();
      return;
    }
    setRevealed({ key: line.key, on: true, nonce: reveal.nonce });
    if (audioOn && line.startSeconds !== null) onSeek(line.startSeconds);
  }, [reveal, ready, lines, audioOn, onSeek]);

  useEffect(() => {
    if (!revealed?.on) return;
    const element = boxRef.current?.querySelector<HTMLElement>(
      `[data-line-key="${String(revealed.key)}"]`,
    );
    // Test DOMs lack scrollIntoView; the reveal still focuses the line.
    if (element !== undefined && element !== null && 'scrollIntoView' in element) {
      element.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    }
    element?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => {
      setRevealed((current) =>
        current?.nonce === revealed.nonce ? { ...current, on: false } : current,
      );
    }, REVEAL_HIGHLIGHT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [revealed, still]);

  if (model.phase === 'loading') {
    return (
      <div data-testid="TranscriptLoading">
        <SkeletonText lines={8} label={t('Ui_Loading')} />
      </div>
    );
  }
  if (model.phase === 'error') {
    return (
      <Notice tone="warning">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('Ui_SessionPageLoadFailedText')}</span>
          <Button size="sm" onClick={model.retry} data-testid="BtnTranscriptRetry">
            {t('Ui_SessionPageRetryContent')}
          </Button>
        </div>
      </Notice>
    );
  }
  if (!hasTranscriptContent(model.text)) {
    return (
      <div className="flex flex-col items-start gap-3 py-6" data-testid="TranscriptEmpty">
        <p className="text-ui-lg text-ink-muted">{t('TranscriptPage_Empty.Text')}</p>
        <Button
          variant="primary"
          data-testid="BtnTranscriptEmptyRecord"
          onClick={() => {
            void window.vozella.invoke('workspace.dispatch', {
              action: { type: 'navigateTo', tag: 'Recording' },
            });
          }}
        >
          {t('TranscriptPage_EmptyCta.Content')}
        </Button>
      </div>
    );
  }
  return (
    <>
      {audioOn ? <AudioBar player={player} src={audioUrl(meetingId)} /> : null}
      <div
        ref={boxRef}
        id="TxtTranscriptContent"
        data-testid="TxtTranscriptContent"
        role="region"
        aria-label={t('SessionPage_TabTranscript.Text')}
        tabIndex={0}
        className="max-h-[calc(100vh-21rem)] min-h-40 overflow-y-auto overflow-x-hidden rounded-control py-1 ps-3 pe-2 text-ui-lg leading-6 text-ink select-text focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {lines.map((line) => (
          <Line
            key={line.key}
            line={line}
            onSeek={audioOn ? onSeek : undefined}
            revealed={revealed?.key === line.key}
            highlighted={revealed?.key === line.key && revealed.on}
          />
        ))}
      </div>
    </>
  );
}
