import { useRef } from 'react';
import { Button, Dialog } from '../../ui';

export interface RegenerateDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly labels: {
    readonly title: string;
    /** Already filled in with the meeting title. */
    readonly content: string;
    readonly primary: string;
    readonly cancel: string;
    readonly close: string;
  };
}

/** Replacing a summary asks first. Focus starts on Cancel; only the primary button proceeds. */
export function RegenerateDialog({ open, onClose, onConfirm, labels }: RegenerateDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={labels.title}
      description={labels.content}
      closeLabel={labels.close}
      initialFocus={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {labels.primary}
          </Button>
        </>
      }
    />
  );
}
