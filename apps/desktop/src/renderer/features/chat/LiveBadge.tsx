import { Pulse } from '../../ui';

export interface LiveBadgeProps {
  /** The Live scope name, in the UI language ("Live", "En vivo"). */
  readonly label: string;
}

/**
 * The AI panel header while a take records (T2): the recording dot with its halo and the scope
 * name. The halo holds still under reduced motion (Pulse). The dot is decorative; the word says it.
 */
export function LiveBadge({ label }: LiveBadgeProps) {
  return (
    <span
      data-testid="BadgeChatLive"
      className="inline-flex h-6 min-w-0 items-center gap-1 rounded-full border border-hairline ps-0.5 pe-2.5 forced-colors:border-[CanvasText]"
    >
      <Pulse active />
      <span data-testid="LblMeetingChatScope" className="truncate text-ui font-medium text-ink">
        {label}
      </span>
    </span>
  );
}
