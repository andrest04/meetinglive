import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button, Icon, Mark, Menu, cn } from '../ui';

/** hidden: nothing shows; in: entrance plays; shown: static; out: the exit plays, then hidden. */
export type PopupPhase = 'hidden' | 'in' | 'shown' | 'out';

export interface MeetingPopupProps {
  readonly phase: PopupPhase;
  /** Changes on every show, so a repeated show restarts the entrance. */
  readonly showId: number;
  readonly title: string;
  readonly subtitle: string;
  readonly startLabel: string;
  readonly moreLabel: string;
  readonly dismissLabel: string;
  readonly neverAgainLabel: string;
  readonly onStart: () => void;
  readonly onDismiss: () => void;
  readonly onNeverAgain: () => void;
  /** The pointer entered or left the card. */
  readonly onHover: (inside: boolean) => void;
}

/** The floating "meeting detected" card. Presentational: the container owns events and calls. */
export function MeetingPopup(props: MeetingPopupProps) {
  const [hovered, setHovered] = useState(false);
  const hover = (inside: boolean): void => {
    setHovered(inside);
    props.onHover(inside);
  };
  return (
    <div className="h-screen w-screen">
      <div
        key={props.showId}
        data-phase={props.phase}
        onPointerEnter={() => {
          hover(true);
        }}
        onPointerLeave={() => {
          hover(false);
        }}
        className="popup-card relative flex h-full w-full items-center gap-3 overflow-hidden rounded-overlay border border-hairline bg-paper-raised px-4 text-ink forced-colors:border-[CanvasText]"
      >
        <span
          aria-hidden="true"
          data-testid="popup-overlay"
          data-visible={hovered}
          className={cn(
            'pointer-events-none absolute inset-0 bg-hover opacity-0 transition-opacity duration-150',
            'data-[visible=true]:opacity-100 motion-reduce:transition-none',
          )}
        />
        <div className="relative flex size-10 shrink-0 items-center justify-center rounded-control border border-hairline bg-paper text-ink">
          <Mark size={24} />
        </div>
        <div className="relative min-w-0 flex-1">
          <p id="TxtMeetingPromptTitle" className="truncate text-ui-lg font-medium text-ink">
            {props.title}
          </p>
          <p id="TxtMeetingPromptSubtitle" className="truncate text-caption text-ink-muted">
            {props.subtitle}
          </p>
        </div>
        <div className="relative flex shrink-0 items-center rounded-control bg-ink">
          <Button
            id="BtnMeetingPromptStart"
            variant="primary"
            className="h-9 rounded-r-none border-transparent px-4"
            onClick={props.onStart}
          >
            {props.startLabel}
          </Button>
          <span aria-hidden="true" className="h-5 w-px bg-on-ink opacity-35" />
          <Menu
            side="left"
            align="center"
            collisionPadding={3}
            trigger={
              <Button
                id="BtnMeetingPromptMore"
                variant="primary"
                aria-label={props.moreLabel}
                title={props.moreLabel}
                className="size-9 rounded-l-none border-transparent px-0"
              >
                <Icon icon={ChevronDown} size={14} />
              </Button>
            }
            entries={[
              {
                id: 'MenuMeetingPromptDismiss',
                label: props.dismissLabel,
                onSelect: props.onDismiss,
              },
              {
                id: 'MenuMeetingPromptNeverAgain',
                label: props.neverAgainLabel,
                onSelect: props.onNeverAgain,
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
