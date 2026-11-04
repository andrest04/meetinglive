import { Copy, Pause, Play, Square, Star, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { SHORTCUTS } from '../../app/shortcuts';
import { Button, IconButton, Pulse, ShortcutHint, Tooltip } from '../../ui';

export interface RecordingBarProps {
  readonly elapsed: string;
  readonly title: string;
  /** The destination path, shown as the title's tooltip. */
  readonly destination: string;
  /** "Mic: {0} · Audio: {1}". */
  readonly sources: string;
  readonly paused: boolean;
  /** The level meter; it follows its own event so a tick redraws only the meter. */
  readonly meter: ReactNode;
  /** A stop or discard is already running. */
  readonly busy: boolean;
  readonly hasText: boolean;
  readonly onStop: () => void;
  readonly onTogglePause: () => void;
  readonly onHighlight: () => void;
  readonly onCopy: () => void;
  readonly onDiscard: () => void;
}

const withKeys = (label: string, id: keyof typeof SHORTCUTS) => (
  <ShortcutHint label={label} chords={[SHORTCUTS[id].keys]} />
);

/**
 * The row that stays put during a take (spec 2.6): the live dot, the elapsed time, what is being
 * recorded, the level, and the five controls in tab order Stop, Pause, Highlight, Copy, Discard.
 * Presentational: the container owns the clock, the commands and the feedback timers.
 */
export function RecordingBar({
  elapsed,
  title,
  destination,
  sources,
  paused,
  meter,
  busy,
  hasText,
  onStop,
  onTogglePause,
  onHighlight,
  onCopy,
  onDiscard,
}: RecordingBarProps) {
  const t = useT();
  return (
    <div
      data-testid="recording-bar"
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-control border border-hairline px-4 py-3"
    >
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
        <Pulse active={!paused} />
        <div className="flex min-w-0 flex-col">
          <span
            role="timer"
            aria-label={t('RecordPage_ElapsedTime.AutomationProperties.Name')}
            data-testid="elapsed"
            className="font-mono text-heading leading-6 font-medium tabular-nums"
          >
            {elapsed}
          </span>
          <Tooltip content={destination} side="bottom">
            <span className="truncate text-ui font-medium text-ink" data-testid="bar-title">
              {title}
            </span>
          </Tooltip>
          <span className="truncate text-caption text-ink-muted" data-testid="bar-sources">
            {sources}
          </span>
        </div>
      </div>

      {meter}

      <div className="flex shrink-0 items-center gap-2">
        <Tooltip content={withKeys(t('Record_Stop'), 'stop')}>
          <Button
            variant="primary"
            icon={Square}
            disabled={busy}
            data-testid="BtnStop"
            onClick={onStop}
          >
            {t('Record_Stop')}
          </Button>
        </Tooltip>
        <Tooltip content={withKeys(paused ? t('Record_Resume') : t('Record_Pause'), 'pause')}>
          <Button
            icon={paused ? Play : Pause}
            disabled={busy}
            data-testid="BtnPause"
            className="min-w-28"
            onClick={onTogglePause}
          >
            {paused ? t('Record_Resume') : t('Record_Pause')}
          </Button>
        </Tooltip>
        <Tooltip content={t('RecordPage_HighlightTooltip')}>
          <IconButton
            label={t('Record_Highlight')}
            icon={Star}
            variant="secondary"
            tooltip={false}
            disabled={busy}
            data-testid="BtnHighlight"
            onClick={onHighlight}
          />
        </Tooltip>
        <IconButton
          label={t('RecordPage_Copy.Content')}
          icon={Copy}
          variant="secondary"
          disabled={!hasText}
          data-testid="BtnCopy"
          onClick={onCopy}
        />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
        <Tooltip content={withKeys(t('Record_Discard'), 'discard')}>
          <IconButton
            label={t('Record_Discard')}
            icon={Trash2}
            variant="secondary"
            tooltip={false}
            disabled={busy}
            data-testid="BtnDiscard"
            onClick={onDiscard}
          />
        </Tooltip>
      </div>
    </div>
  );
}
