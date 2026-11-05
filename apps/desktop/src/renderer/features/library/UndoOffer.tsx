import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton, cn } from '../../ui';
import { popupColors, popupSurface } from '../../ui/styles';

/** Long enough to read and reach. It waits while the pointer or the focus is on it. */
export const UNDO_OFFER_MS = 8000;

export interface UndoOfferProps {
  readonly message: string;
  readonly undoLabel: string;
  readonly dismissLabel: string;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

/** One move can be taken back for a moment. It sits inside the list pane, over no other control. */
export function UndoOffer({ message, undoLabel, dismissLabel, onUndo, onDismiss }: UndoOfferProps) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onDismiss, UNDO_OFFER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [held, onDismiss, message]);

  return (
    <div
      onMouseEnter={() => {
        setHeld(true);
      }}
      onMouseLeave={() => {
        setHeld(false);
      }}
      onFocus={() => {
        setHeld(true);
      }}
      onBlur={() => {
        setHeld(false);
      }}
      className={cn(
        popupSurface,
        popupColors,
        'absolute inset-x-3 bottom-3 z-20 flex items-center gap-2 py-1.5 ps-3 pe-1.5',
      )}
    >
      <span role="status" className="min-w-0 flex-1 text-ui text-ink">
        {message}
      </span>
      <Button size="sm" onClick={onUndo}>
        {undoLabel}
      </Button>
      <IconButton label={dismissLabel} icon={X} size="sm" onClick={onDismiss} />
    </div>
  );
}
