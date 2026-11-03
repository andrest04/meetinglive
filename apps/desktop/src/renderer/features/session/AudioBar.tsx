import { Pause, Play } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import { IconButton } from '../../ui';
import { formatClock, type AudioPlayer } from './use-audio-player';

/**
 * Play, scrubber and clock for the saved audio. The one <audio> element lives here, hidden
 * behind our own controls; the state comes from the player so transcript lines can seek it.
 */
export function AudioBar({ player, src }: { readonly player: AudioPlayer; readonly src: string }) {
  const t = useT();
  const { playing, current, duration } = player;
  return (
    <div
      data-testid="AudioBar"
      className="mb-2 flex items-center gap-3 border-b border-hairline pb-2"
    >
      <audio src={src} preload="metadata" data-testid="AudioElement" {...player.audioProps} />
      <IconButton
        size="sm"
        icon={playing ? Pause : Play}
        label={playing ? t('Ui_SessionAudioPause') : t('Ui_SessionAudioPlay')}
        data-testid="BtnAudioToggle"
        onClick={player.toggle}
      />
      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 1}
        step={0.1}
        value={Math.min(current, duration > 0 ? duration : 0)}
        disabled={duration <= 0}
        aria-label={t('Ui_SessionAudioPosition')}
        aria-valuetext={`${formatClock(current)} / ${formatClock(duration)}`}
        data-testid="AudioScrubber"
        onChange={(event) => {
          player.seek(Number(event.currentTarget.value));
        }}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-ink disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4"
      />
      <span
        data-testid="AudioClock"
        className="shrink-0 font-mono text-ui tabular-nums text-ink-muted"
      >
        {formatClock(current)} / {formatClock(duration)}
      </span>
    </div>
  );
}
