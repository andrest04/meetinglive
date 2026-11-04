import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';

/** Library, settings storage and workspace channels (module: library-storage). */

const empty = z.object({}).strict();
const guid = z.string().min(1);

export const folderSchema = z.object({
  id: guid,
  name: z.string(),
  parentId: z.string().nullable(),
  note: z.string().nullable(),
  colorKey: z.string().nullable(),
  iconKey: z.string().nullable(),
  createdAt: z.string(),
});
export type FolderDto = z.infer<typeof folderSchema>;

export const meetingListItemSchema = z.object({
  id: guid,
  title: z.string(),
  /** Round-trip text with offset; the UI formats it in the user's locale. */
  recordedAt: z.string(),
  endedAt: z.string().nullable(),
  folderId: z.string().nullable(),
  snippet: z.string(),
  hasSummary: z.boolean(),
  hasTranscript: z.boolean(),
  /** A summary is being generated for this meeting. */
  busy: z.boolean(),
});
export type MeetingListItemDto = z.infer<typeof meetingListItemSchema>;

const jevSchema = z.object({
  meetingType: z.string().nullable(),
  meetingTypeConfidence: z.number().nullable(),
  spokenLanguage: z.string().nullable(),
  urgencyScore: z.number(),
  urgencyConfidence: z.number().nullable(),
  containsDecisions: z.number(),
  containsCommitments: z.number(),
  piiRisk: z.number(),
  summaryFaithful: z.number().nullable(),
  suggestedFolderId: z.string().nullable(),
  folderConfidence: z.number().nullable(),
  actionItems: z
    .array(z.object({ text: z.string(), relation: z.string(), confidence: z.number().nullable() }))
    .readonly(),
  model: z.string(),
  analyzedAt: z.string(),
});

/** The full meeting, for the session screens. */
export const meetingRecordSchema = z.object({
  id: guid,
  title: z.string(),
  recordedAt: z.string(),
  endedAt: z.string().nullable(),
  audioFilePath: z.string(),
  sourcePath: z.string().nullable(),
  folderId: z.string().nullable(),
  summaryProvider: z.string().nullable(),
  calendarEventId: z.string().nullable(),
  calendarId: z.string().nullable(),
  seriesId: z.string().nullable(),
  joinUrl: z.string().nullable(),
  noteTemplateId: z.string().nullable(),
  attendees: z.array(z.string()).readonly(),
  brief: z.string().nullable(),
  transcript: z.string().nullable(),
  summary: z.string().nullable(),
  actionItems: z.array(z.object({ text: z.string(), isDone: z.boolean() })).readonly(),
  jevAnalysis: jevSchema.nullable(),
  notes: z.string().nullable(),
  followUp: z.string().nullable(),
  projectPlan: z.string().nullable(),
});
export type MeetingRecordDto = z.infer<typeof meetingRecordSchema>;

export const failureReasonSchema = z.enum([
  'empty-name',
  'name-taken',
  'not-found',
  'not-empty',
  'busy',
  'corrupt',
  'io-failed',
]);
export type FailureReasonDto = z.infer<typeof failureReasonSchema>;

const failureShape = {
  ok: z.literal(false),
  reason: failureReasonSchema,
  /** Error text for `io-failed` and `corrupt`; show it after a localized lead-in. */
  message: z.string().optional(),
};

const done = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object(failureShape),
]);
const folderResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), folder: folderSchema }),
  z.object(failureShape),
]);

export const libraryLoad = defineRequest('library.load', {
  input: empty,
  output: z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      folders: z.array(folderSchema).readonly(),
      meetings: z.array(meetingListItemSchema).readonly(),
      /** Files that could not be read as meetings. */
      skipped: z.array(z.object({ path: z.string(), reason: z.string() })).readonly(),
    }),
    z.object(failureShape),
  ]),
});

export const libraryGetMeeting = defineRequest('library.getMeeting', {
  input: z.object({ id: guid }),
  output: z.object({ record: meetingRecordSchema.nullable() }),
});

export const libraryCreateFolder = defineRequest('library.createFolder', {
  input: z.object({ name: z.string().max(500), parentId: z.string().nullable() }),
  output: folderResult,
});

export const libraryRenameFolder = defineRequest('library.renameFolder', {
  input: z.object({ id: guid, name: z.string().max(500) }),
  output: folderResult,
});

export const libraryUpdateFolderPersonality = defineRequest('library.updateFolderPersonality', {
  input: z.object({ id: guid, colorKey: z.string().nullable(), iconKey: z.string().nullable() }),
  output: folderResult,
});

export const librarySetFolderNote = defineRequest('library.setFolderNote', {
  input: z.object({ id: guid, note: z.string().max(100_000).nullable() }),
  output: folderResult,
});

export const libraryDeleteFolder = defineRequest('library.deleteFolder', {
  input: z.object({ id: guid }),
  output: done,
});

export const libraryMoveMeeting = defineRequest('library.moveMeeting', {
  input: z.object({ meetingId: guid, folderId: z.string().nullable() }),
  output: done,
});

export const libraryDeleteMeeting = defineRequest('library.deleteMeeting', {
  input: z.object({ meetingId: guid }),
  output: done,
});

export const libraryIsMeetingBusy = defineRequest('library.isMeetingBusy', {
  input: z.object({ meetingId: guid }),
  output: z.object({ busy: z.boolean() }),
});

export const locationSchema = z.object({
  libraryRoot: z.string(),
  appDataRoot: z.string(),
  source: z.enum(['env', 'default', 'dev-fallback', 'chosen']),
  /** The Library root sits inside a folder named MeetingLive (the WinUI app's data). */
  sharesMeetingLive: z.boolean(),
  version: z.string(),
  startupError: z.string().nullable(),
});
export type LocationDto = z.infer<typeof locationSchema>;

export const libraryGetLocation = defineRequest('library.getLocation', {
  input: empty,
  output: locationSchema,
});

export const libraryOpenFolder = defineRequest('library.openFolder', {
  input: empty,
  output: z.object({ opened: z.boolean(), error: z.string().nullable() }),
});

const setLocationResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('changed'), location: locationSchema }),
  z.object({ status: z.literal('cancelled') }),
  z.object({
    status: z.literal('refused'),
    reason: z.enum(['not-absolute', 'forbidden', 'unusable']),
    message: z.string(),
  }),
]);

/** Opens the folder picker and applies the choice. */
export const libraryChooseLocation = defineRequest('library.chooseLocation', {
  input: empty,
  output: setLocationResult,
});

/** Sets the Library root to a path, or back to the default with `null`. */
export const librarySetLocation = defineRequest('library.setLocation', {
  input: z.object({ path: z.string().nullable() }),
  output: setLocationResult,
});

export const libraryChanged = defineEvent('library.changed', {
  payload: z.object({ reason: z.enum(['meeting', 'folder', 'location']) }),
});

// ---------------------------------------------------------------- settings

export const appSettingsSchema = z.object({
  selectedSummaryModelId: z.string().nullable(),
  selectedSummaryProvider: z.string().nullable(),
  selectedXaiModelId: z.string().nullable(),
  selectedXaiEffort: z.string().nullable(),
  selectedClaudeModelId: z.string().nullable(),
  selectedClaudeEffort: z.string().nullable(),
  selectedCodexModelId: z.string().nullable(),
  selectedCodexEffort: z.string().nullable(),
  transcriptionLanguage: z.string().nullable(),
  summaryLanguage: z.string().nullable(),
  selectedMicrophoneDeviceId: z.string().nullable(),
  recordMicrophoneKind: z.string().nullable(),
  recordMicrophoneDeviceId: z.string().nullable(),
  recordOutputKind: z.string().nullable(),
  recordAppExePath: z.string().nullable(),
  recordAppName: z.string().nullable(),
  liveTranscriptionEnabled: z.boolean(),
  speakerDiarizationEnabled: z.boolean(),
  typeSafeEnabled: z.boolean(),
  calendarNotificationsEnabled: z.boolean(),
  meetingPopupEnabled: z.boolean(),
  disabledCalendarIds: z.array(z.string()).readonly(),
  uiLanguage: z.string().nullable(),
  navigationPaneLength: z.number().nullable(),
  liveCopilotPillX: z.number().nullable(),
  liveCopilotPillY: z.number().nullable(),
  liveCopilotPillEdge: z.string().nullable(),
  liveCopilotPillAlong: z.number().nullable(),
});
export type AppSettingsDto = z.infer<typeof appSettingsSchema>;

export const settingsGet = defineRequest('settings.get', {
  input: empty,
  output: appSettingsSchema,
});

/** Changes only the fields named in the patch; other fields and unknown keys are untouched. */
export const settingsUpdate = defineRequest('settings.update', {
  input: z.object({ patch: appSettingsSchema.partial().strict() }),
  output: appSettingsSchema,
});

// --------------------------------------------------------------- workspace

export const shellTagSchema = z.enum(['Recording', 'History', 'Settings', 'Session']);
export const sessionTabSchema = z.enum(['Transcript', 'Summary']);

export const workspaceStateSchema = z.object({
  selectedMeetingId: z.string().nullable(),
  lastProcessedMeetingId: z.string().nullable(),
  sessionTab: sessionTabSchema,
  currentShellTag: shellTagSchema,
  selectedFolderId: z.string().nullable(),
  liveTranscript: z.string(),
  isCaptureActive: z.boolean(),
});
export type WorkspaceStateDto = z.infer<typeof workspaceStateSchema>;

export const workspaceActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('selectMeeting'), id: z.string().nullable() }),
  z.object({ type: z.literal('clearSelection') }),
  z.object({ type: z.literal('setLastProcessed'), id: guid }),
  z.object({ type: z.literal('setSessionTab'), tab: sessionTabSchema }),
  z.object({ type: z.literal('setCurrentShellTag'), tag: shellTagSchema }),
  z.object({ type: z.literal('navigateTo'), tag: shellTagSchema }),
  z.object({ type: z.literal('openSession'), tab: sessionTabSchema }),
  z.object({ type: z.literal('publishSelectedFolder'), folderId: z.string().nullable() }),
  z.object({ type: z.literal('setLiveTranscript'), text: z.string() }),
  z.object({ type: z.literal('setCaptureActive'), active: z.boolean() }),
  z.object({
    type: z.literal('requestTakeNotes'),
    calendarEventId: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('consumeTakeNotes') }),
  z.object({ type: z.literal('notifyMeetingChanged'), id: guid }),
]);
export type WorkspaceActionDto = z.infer<typeof workspaceActionSchema>;

export const workspaceGetState = defineRequest('workspace.getState', {
  input: empty,
  output: workspaceStateSchema,
});

export const workspaceDispatch = defineRequest('workspace.dispatch', {
  input: z.object({ action: workspaceActionSchema }),
  output: z.object({
    state: workspaceStateSchema,
    /** Only for `consumeTakeNotes`. */
    takeNotes: z
      .object({ pending: z.boolean(), calendarEventId: z.string().nullable() })
      .optional(),
  }),
});

/** The shell is the only listener that navigates; pages ask through `navigateTo`. */
export const workspaceNavigationRequested = defineEvent('workspace.navigationRequested', {
  payload: z.object({ tag: shellTagSchema }),
});

export const workspaceChanged = defineEvent('workspace.changed', {
  payload: z.object({ state: workspaceStateSchema }),
});

export const workspaceMeetingDeleted = defineEvent('workspace.meetingDeleted', {
  payload: z.object({ id: guid }),
});

export const workspaceMeetingChanged = defineEvent('workspace.meetingChanged', {
  payload: z.object({ id: guid }),
});

export const workspaceTakeNotesRequested = defineEvent('workspace.takeNotesRequested', {
  payload: z.object({}).strict(),
});
