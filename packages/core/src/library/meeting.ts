export interface ActionItem {
  readonly text: string;
  readonly isDone: boolean;
}

export interface JevActionVerdict {
  readonly text: string;
  readonly relation: string;
  readonly confidence: number | null;
}

/** Typed Jev judgments for one meeting (stored as one JSON line under `## Jev`). */
export interface JevAnalysis {
  readonly meetingType: string | null;
  readonly meetingTypeConfidence: number | null;
  readonly spokenLanguage: string | null;
  readonly urgencyScore: number;
  readonly urgencyConfidence: number | null;
  readonly containsDecisions: number;
  readonly containsCommitments: number;
  readonly piiRisk: number;
  readonly summaryFaithful: number | null;
  readonly suggestedFolderId: string | null;
  readonly folderConfidence: number | null;
  readonly actionItems: readonly JevActionVerdict[];
  readonly model: string;
  readonly analyzedAt: string;
}

/** One meeting as stored in a Markdown file (spec 4.1). */
export interface MeetingRecord {
  /** Lowercase hyphenated GUID. */
  readonly id: string;
  readonly title: string;
  /** Round-trip text with seven fraction digits and a numeric offset. */
  readonly recordedAt: string;
  readonly endedAt: string | null;
  /** Absolute path. Empty when there is no recording. */
  readonly audioFilePath: string;
  /** Where the record was read from. Never written. */
  readonly sourcePath: string | null;
  readonly folderId: string | null;
  readonly summaryProvider: string | null;
  readonly calendarEventId: string | null;
  readonly calendarId: string | null;
  readonly seriesId: string | null;
  readonly joinUrl: string | null;
  readonly noteTemplateId: string | null;
  readonly attendees: readonly string[];
  readonly brief: string | null;
  readonly transcript: string | null;
  readonly summary: string | null;
  readonly actionItems: readonly ActionItem[];
  readonly jevAnalysis: JevAnalysis | null;
  /** Personal notes. */
  readonly notes: string | null;
  readonly followUp: string | null;
  readonly projectPlan: string | null;
}

/** What the Library list needs: no transcript, no summary text. */
export interface MeetingListItem {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: string;
  readonly endedAt: string | null;
  readonly folderId: string | null;
  readonly snippet: string;
  readonly hasSummary: boolean;
  readonly hasTranscript: boolean;
  /** A summary is being generated. Repositories report false; the Library service fills it in. */
  readonly busy: boolean;
}

/** A markdown file that could not be read as a meeting, with the reason. */
export interface SkippedMeetingFile {
  readonly path: string;
  readonly reason: string;
}

export class MeetingFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingFormatError';
  }
}
