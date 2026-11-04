import type { RecordingStateDto } from '@vozella/contracts';
import { formatElapsed } from '@vozella/core';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { LiveCanvas } from './LiveCanvas';
import { DiscardDialog } from './DiscardDialog';
import { RecordingBar } from './RecordingBar';
import { RecordingLevel } from './RecordingLevel';
import {
  copyToClipboard,
  discardRecording,
  highlightMoment,
  pauseRecording,
  resumeRecording,
  stopRecording,
} from './use-recording';
import { useElapsed } from './use-elapsed';
import { useRecordShortcuts, type RecordShortcutHandlers } from './use-record-shortcuts';
import { useTimedValue } from './use-timed-value';

/** Spec 2.6: the highlight feedback clears after 2 s, the "Copied" bar after 2.5 s. */
export const HIGHLIGHT_FEEDBACK_MS = 2000;
export const COPIED_BAR_MS = 2500;

/**
 * Copy of the canvas text with the "Copied" bar (item 70). One restartable timer; a failed copy
 * shows nothing. Used by the recording bar and by the finished transcript's Copy button.
 */
export function useCanvasCopy(text: string): { copied: boolean; copy: () => void } {
  const { value, show } = useTimedValue<true>(COPIED_BAR_MS);
  const copy = useCallback(() => {
    if (text === '') return;
    void copyToClipboard(text).then((ok) => {
      if (ok) show(true);
    });
  }, [text, show]);
  return { copied: value !== null, copy };
}

export interface RecordingSessionProps {
  readonly state: RecordingStateDto;
  /** The canvas text with the highlight stars, from main. */
  readonly liveText: string;
  /** What the engine will not rewrite; the lines after it are the interim tail. */
  readonly committedText: string;
  readonly destination: string;
  /** "Mic: {0} · Audio: {1}". */
  readonly sources: string;
  /** The status caption beside the heading; empty when it is an error (the bars show those). */
  readonly statusText: string;
  /** The placeholder of an empty canvas. */
  readonly emptyText: string;
  /** The notes block, beside the canvas when there is room (spec 2.1). */
  readonly side: ReactNode;
  /** The typed question box under the canvas. */
  readonly dock?: ReactNode;
  readonly sideBySide: boolean;
}

const countLines = (text: string): number =>
  text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').length;

/**
 * The recording bar and the live canvas with their commands (spec 2.6 and 2.7). Rendered while a
 * take records; the processing states have their own bar. Main owns the take: each command is a
 * request and the next state push is what the page draws.
 */
export function RecordingSession({
  state,
  liveText,
  committedText,
  destination,
  sources,
  statusText,
  emptyText,
  side,
  dock = null,
  sideBySide,
}: RecordingSessionProps) {
  const t = useT();
  const elapsed = useElapsed(state);
  const feedback = useTimedValue<string>(HIGHLIGHT_FEEDBACK_MS);
  const { copied, copy } = useCanvasCopy(liveText);
  const [confirming, setConfirming] = useState(false);

  const controllable = state.phase === 'Recording';
  const paused = state.isPaused;

  const togglePause = useCallback(() => {
    void (paused ? resumeRecording() : pauseRecording());
  }, [paused]);

  const highlight = useCallback(() => {
    void highlightMoment().then((elapsedMs) => {
      if (elapsedMs !== null) {
        feedback.show(t('RecordPage_Highlighted', formatElapsed(elapsedMs)));
      }
    });
  }, [feedback, t]);

  const askDiscard = useCallback(() => {
    setConfirming(true);
  }, []);

  const shortcuts = useMemo<RecordShortcutHandlers>(
    () => ({
      stop: { enabled: controllable && !confirming, run: () => void stopRecording() },
      pause: { enabled: controllable && !confirming, run: togglePause },
      discard: { enabled: controllable && !confirming, run: askDiscard },
    }),
    [controllable, confirming, togglePause, askDiscard],
  );
  useRecordShortcuts(shortcuts);

  const committedLines = useMemo(() => countLines(committedText), [committedText]);

  return (
    <div className="flex min-h-0 flex-col gap-5" data-testid="recording-session">
      <RecordingBar
        elapsed={elapsed}
        title={state.title}
        destination={destination}
        sources={sources}
        paused={paused}
        busy={!controllable}
        hasText={liveText !== ''}
        meter={state.microphoneActive ? <RecordingLevel paused={paused} /> : undefined}
        onStop={() => void stopRecording()}
        onTogglePause={togglePause}
        onHighlight={highlight}
        onCopy={copy}
        onDiscard={askDiscard}
      />
      <div
        className={
          sideBySide
            ? 'grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4'
            : 'flex flex-col gap-4'
        }
        data-testid="record-session"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <LiveCanvas
            heading={t('RecordPage_LiveTranscript.Text')}
            live={!paused}
            text={liveText}
            committedLines={committedLines}
            emptyText={emptyText}
            highlightFeedback={feedback.value}
            statusText={statusText === '' ? null : statusText}
            copied={copied}
            onCopy={null}
            className="h-[clamp(16rem,calc(100vh-26rem),48rem)]"
          />
          {dock}
        </div>
        {side}
      </div>
      <DiscardDialog
        open={confirming}
        onKeep={() => {
          setConfirming(false);
        }}
        onDiscard={() => {
          setConfirming(false);
          // The take may have ended while the dialog was open: only a running one is discarded.
          if (controllable) void discardRecording();
        }}
      />
    </div>
  );
}
