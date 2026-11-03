import { Notice } from '../../ui';
import type { DraftMessageState } from './use-summary-generation';

/**
 * The result of "Copy action items". A plain inline notice with no title (B16): the WinUI page
 * put "Could not create the draft" over a success message. Errors stay until the next action;
 * a success is cleared by the hook after a few seconds.
 */
export function DraftMessage({ message }: { readonly message: DraftMessageState | null }) {
  if (message === null) return null;
  return (
    <div data-testid="DraftMessage" data-kind={message.kind}>
      <Notice tone={message.kind === 'error' ? 'warning' : 'info'}>{message.text}</Notice>
    </div>
  );
}
