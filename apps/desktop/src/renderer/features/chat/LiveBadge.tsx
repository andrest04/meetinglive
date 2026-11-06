import { Pulse } from '../../ui';

export interface LiveBadgeProps {
  /** The Live scope name, in the UI language ("Live", "En vivo"). */
  readonly label: string;
  /** The take is paused: the dot holds still and `pausedLabel` follows the name. */
  readonly paused?: boolean;
  /** "Paused" in the UI language; shown only while paused. */
  readonly pausedLabel?: string;
}

/**
 * The AI panel header while a take records (T2): the recording dot with its halo and the scope
 * name. The halo holds still under reduced motion (Pulse) and while the take is paused, when the
 * word "Paused" follows the name. The dot is decorative; the words say it.
 */
export function LiveBadge({ label, paused = false, pausedLabel }: LiveBadgeProps) {
  return (
    <span
      data-testid="BadgeChatLive"
      data-paused={paused ? 'true' : 'false'}
      className="inline-flex h-6 min-w-0 items-center gap-1 rounded-full border border-hairline ps-0.5 pe-2.5 forced-colors:border-[CanvasText]"
    >
      <Pulse active={!paused} />
      <span data-testid="LblMeetingChatScope" className="truncate text-ui font-medium text-ink">
        {label}
      </span>
      {paused && pausedLabel !== undefined ? (
        <span data-testid="LblChatLivePaused" className="shrink-0 text-ui text-ink-muted">
          {pausedLabel}
        </span>
      ) : null}
    </span>
  );
}
