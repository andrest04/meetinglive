import type { RefObject } from 'react';

/** What a tab gives the Copy button: its text, or null when it has nothing to copy. */
export type CopySource = () => Promise<string | null>;
export type CopySourceRef = RefObject<CopySource | null>;

/**
 * Temporary stand-in for the Transcript tab. sv-5 replaces this file's body with the document
 * view and registers its copy text on `copySourceRef`; the slot and its props stay the same.
 */
export function TranscriptSlot(_props: {
  readonly meetingId: string;
  readonly copySourceRef: CopySourceRef;
}) {
  return <div data-testid="TranscriptSlot" className="min-h-24" />;
}
