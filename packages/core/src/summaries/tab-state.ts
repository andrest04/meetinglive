import type { ActionItem } from '../library/meeting';
import type { NoteTemplateOption } from '../settings/note-templates';
import type { RelatedMeetingItem } from './related-meetings';

export interface TabFlagInput {
  readonly hasMeeting: boolean;
  readonly summary: string | null;
  readonly transcript: string | null;
  readonly isShowingNotes: boolean;
  readonly isLoading: boolean;
  readonly isGenerating: boolean;
}

/** The derived flags of spec 2.2. The renderer recomputes them when the mode or run state changes. */
export interface TabFlags {
  readonly hasSummary: boolean;
  readonly canGenerate: boolean;
  readonly canRegenerate: boolean;
  readonly showEnhancedChrome: boolean;
  readonly showNoteTemplate: boolean;
  readonly showSummaryActionBar: boolean;
  readonly showDraftActions: boolean;
  readonly isEmpty: boolean;
  readonly canExecuteGenerate: boolean;
  readonly canExecuteRegenerate: boolean;
}

const hasText = (text: string | null | undefined): boolean => (text ?? '').trim() !== '';

export function deriveTabFlags(input: TabFlagInput): TabFlags {
  const hasSummary = hasText(input.summary);
  const hasTranscript = input.hasMeeting && hasText(input.transcript);
  const canGenerate = hasTranscript && !hasSummary;
  const canRegenerate = hasTranscript && hasSummary;
  const showEnhancedChrome = !input.isShowingNotes;
  const showBar = (canGenerate || canRegenerate) && showEnhancedChrome;
  return {
    hasSummary,
    canGenerate,
    canRegenerate,
    showEnhancedChrome,
    showNoteTemplate: showBar,
    showSummaryActionBar: showBar,
    showDraftActions: hasSummary && showEnhancedChrome,
    isEmpty: !input.isLoading && !hasSummary && !canGenerate,
    canExecuteGenerate: canGenerate && !input.isGenerating,
    canExecuteRegenerate: canRegenerate && !input.isGenerating,
  };
}

/** Everything the Summary tab shows after a load. Plain data, safe to send over IPC. */
export interface TabState {
  readonly meetingId: string | null;
  readonly hasMeeting: boolean;
  readonly title: string;
  readonly notes: string;
  readonly summary: string;
  readonly actionItems: readonly ActionItem[];
  /** `auto` when the record has none. */
  readonly noteTemplateId: string;
  readonly templates: readonly NoteTemplateOption[];
  readonly related: readonly RelatedMeetingItem[];
  /** Flags for the enhanced view, loaded and idle. */
  readonly flags: TabFlags;
  /** Whether the record has a transcript, so the renderer can recompute flags. */
  readonly hasTranscript: boolean;
}
