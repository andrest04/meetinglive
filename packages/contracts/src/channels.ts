import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';
import * as audio from './audio';
import * as chat from './chat';
import * as library from './library';
import * as liveCopilot from './live-copilot';
import * as meetingPrompt from './meeting-prompt';
import * as recording from './recording';
import * as session from './session';
import * as settings from './settings';
import * as summaries from './summaries';
import * as transcription from './transcription';

/** No input. An object keeps room to add optional fields without breaking callers. */
const empty = z.object({}).strict();

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
  arch: z.string(),
  isPackaged: z.boolean(),
  /** True when VOZELLA_FAKE_NATIVE selected the fake native adapters. */
  fakeNative: z.boolean(),
  dataRoot: z.object({
    appData: z.string(),
    meetings: z.string(),
    source: z.enum(['env', 'default', 'dev-fallback']),
  }),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

export const appGetInfo = defineRequest('app.getInfo', {
  input: empty,
  output: appInfoSchema,
});

export const appReportRendererError = defineRequest('app.reportRendererError', {
  input: z.object({
    message: z.string().max(2_000),
    stack: z.string().max(10_000).optional(),
    source: z.enum(['error', 'unhandledrejection', 'react']),
  }),
  output: z.object({ logged: z.literal(true) }),
});

export const diagnosticsNativeSelfTest = defineRequest('diagnostics.nativeSelfTest', {
  input: empty,
  output: z.object({
    backend: z.enum(['native', 'fake']),
    platformSupported: z.boolean(),
  }),
});

export const themePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

/**
 * Sets the window chrome theme. The main process applies it to nativeTheme (so
 * prefers-color-scheme follows) and recolors the title bar overlay.
 */
export const appSetThemePreference = defineRequest('app.setThemePreference', {
  input: z.object({ preference: themePreferenceSchema }),
  output: z.object({ resolved: z.enum(['light', 'dark']) }),
});

export const appFocusChanged = defineEvent('app.focusChanged', {
  payload: z.object({ focused: z.boolean() }),
});

export const requestChannels = {
  [appGetInfo.name]: appGetInfo,
  [appReportRendererError.name]: appReportRendererError,
  [diagnosticsNativeSelfTest.name]: diagnosticsNativeSelfTest,
  [appSetThemePreference.name]: appSetThemePreference,
  [library.libraryLoad.name]: library.libraryLoad,
  [library.libraryGetMeeting.name]: library.libraryGetMeeting,
  [library.libraryCreateFolder.name]: library.libraryCreateFolder,
  [library.libraryRenameFolder.name]: library.libraryRenameFolder,
  [library.libraryUpdateFolderPersonality.name]: library.libraryUpdateFolderPersonality,
  [library.librarySetFolderNote.name]: library.librarySetFolderNote,
  [library.libraryDeleteFolder.name]: library.libraryDeleteFolder,
  [library.libraryMoveMeeting.name]: library.libraryMoveMeeting,
  [library.libraryDeleteMeeting.name]: library.libraryDeleteMeeting,
  [library.libraryMoveMeetings.name]: library.libraryMoveMeetings,
  [library.libraryDeleteMeetings.name]: library.libraryDeleteMeetings,
  [library.librarySearch.name]: library.librarySearch,
  [library.libraryIsMeetingBusy.name]: library.libraryIsMeetingBusy,
  [library.libraryGetLocation.name]: library.libraryGetLocation,
  [library.libraryOpenFolder.name]: library.libraryOpenFolder,
  [library.libraryChooseLocation.name]: library.libraryChooseLocation,
  [library.librarySetLocation.name]: library.librarySetLocation,
  [library.settingsGet.name]: library.settingsGet,
  [library.settingsUpdate.name]: library.settingsUpdate,
  [library.workspaceGetState.name]: library.workspaceGetState,
  [library.workspaceDispatch.name]: library.workspaceDispatch,
  [settings.settingsGetPage.name]: settings.settingsGetPage,
  [settings.settingsSetUiLanguage.name]: settings.settingsSetUiLanguage,
  [settings.settingsSetSummaryProvider.name]: settings.settingsSetSummaryProvider,
  [settings.settingsSetCliOption.name]: settings.settingsSetCliOption,
  [settings.settingsSetMeetingLanguage.name]: settings.settingsSetMeetingLanguage,
  [settings.settingsDetectCli.name]: settings.settingsDetectCli,
  [settings.settingsDismissNotice.name]: settings.settingsDismissNotice,
  [settings.settingsModelsDownload.name]: settings.settingsModelsDownload,
  [settings.settingsModelsCancel.name]: settings.settingsModelsCancel,
  [settings.settingsModelsSelect.name]: settings.settingsModelsSelect,
  [settings.settingsModelsDelete.name]: settings.settingsModelsDelete,
  [settings.i18nGetLocale.name]: settings.i18nGetLocale,
  [settings.appRestart.name]: settings.appRestart,
  [audio.audioMicrophonesLoad.name]: audio.audioMicrophonesLoad,
  [audio.audioMicrophonesRemember.name]: audio.audioMicrophonesRemember,
  [audio.audioSourcesStart.name]: audio.audioSourcesStart,
  [audio.audioSourcesStop.name]: audio.audioSourcesStop,
  [audio.audioSourcesSelect.name]: audio.audioSourcesSelect,
  [audio.audioSourcesCloseFallback.name]: audio.audioSourcesCloseFallback,
  [audio.audioPreviewStart.name]: audio.audioPreviewStart,
  [audio.audioPreviewStop.name]: audio.audioPreviewStop,
  [audio.audioImportPickFile.name]: audio.audioImportPickFile,
  [audio.audioRecordingStart.name]: audio.audioRecordingStart,
  [audio.audioRecordingState.name]: audio.audioRecordingState,
  [audio.audioRecordingPause.name]: audio.audioRecordingPause,
  [audio.audioRecordingResume.name]: audio.audioRecordingResume,
  [audio.audioRecordingStop.name]: audio.audioRecordingStop,
  [audio.audioImportRun.name]: audio.audioImportRun,
  [audio.audioAppIcon.name]: audio.audioAppIcon,
  [meetingPrompt.meetingPromptStart.name]: meetingPrompt.meetingPromptStart,
  [meetingPrompt.meetingPromptDismiss.name]: meetingPrompt.meetingPromptDismiss,
  [meetingPrompt.meetingPromptNeverAgain.name]: meetingPrompt.meetingPromptNeverAgain,
  [meetingPrompt.meetingPromptHover.name]: meetingPrompt.meetingPromptHover,
  [meetingPrompt.meetingPromptReady.name]: meetingPrompt.meetingPromptReady,
  [transcription.transcriptionGetStatus.name]: transcription.transcriptionGetStatus,
  [transcription.transcriptionEnsureEngine.name]: transcription.transcriptionEnsureEngine,
  [transcription.transcriptionCancelInstall.name]: transcription.transcriptionCancelInstall,
  [transcription.transcriptionDeleteEngine.name]: transcription.transcriptionDeleteEngine,
  [transcription.transcriptionSetLiveEnabled.name]: transcription.transcriptionSetLiveEnabled,
  [transcription.transcriptionSetSpeakerLabels.name]: transcription.transcriptionSetSpeakerLabels,
  [transcription.transcriptionDownloadSpeakerModel.name]:
    transcription.transcriptionDownloadSpeakerModel,
  [transcription.transcriptionDeleteSpeakerModel.name]:
    transcription.transcriptionDeleteSpeakerModel,
  [transcription.retranscriptionAvailability.name]: transcription.retranscriptionAvailability,
  [transcription.retranscriptionStart.name]: transcription.retranscriptionStart,
  [transcription.retranscriptionCancel.name]: transcription.retranscriptionCancel,
  [transcription.retranscriptionGetState.name]: transcription.retranscriptionGetState,
  [transcription.retranscriptionDismiss.name]: transcription.retranscriptionDismiss,
  [summaries.summariesLoadTab.name]: summaries.summariesLoadTab,
  [summaries.summariesGenerate.name]: summaries.summariesGenerate,
  [summaries.summariesCancel.name]: summaries.summariesCancel,
  [summaries.summariesSaveNotes.name]: summaries.summariesSaveNotes,
  [summaries.summariesToggleAction.name]: summaries.summariesToggleAction,
  [summaries.summariesReplaceSummary.name]: summaries.summariesReplaceSummary,
  [summaries.summariesCopyActions.name]: summaries.summariesCopyActions,
  [summaries.summariesCopyText.name]: summaries.summariesCopyText,
  [summaries.summariesWriteClipboard.name]: summaries.summariesWriteClipboard,
  [summaries.summariesSetTemplate.name]: summaries.summariesSetTemplate,
  [summaries.summariesProviderStatus.name]: summaries.summariesProviderStatus,
  [summaries.summariesHardware.name]: summaries.summariesHardware,
  [summaries.summariesCheckCli.name]: summaries.summariesCheckCli,
  [summaries.summariesChooseLocalModel.name]: summaries.summariesChooseLocalModel,
  [summaries.summariesCancelLocalModel.name]: summaries.summariesCancelLocalModel,
  [summaries.summariesChooseCli.name]: summaries.summariesChooseCli,
  [recording.recordingGetState.name]: recording.recordingGetState,
  [recording.recordingGetSetup.name]: recording.recordingGetSetup,
  [recording.recordingStart.name]: recording.recordingStart,
  [recording.recordingPause.name]: recording.recordingPause,
  [recording.recordingResume.name]: recording.recordingResume,
  [recording.recordingStop.name]: recording.recordingStop,
  [recording.recordingDiscard.name]: recording.recordingDiscard,
  [recording.recordingHighlight.name]: recording.recordingHighlight,
  [recording.recordingSetNotes.name]: recording.recordingSetNotes,
  [recording.recordingCancelProcessing.name]: recording.recordingCancelProcessing,
  [recording.recordingRetryProcessing.name]: recording.recordingRetryProcessing,
  [recording.recordingImport.name]: recording.recordingImport,
  [recording.recordingImportUrl.name]: recording.recordingImportUrl,
  [recording.recordingCloseAnswer.name]: recording.recordingCloseAnswer,
  [recording.recordingAsk.name]: recording.recordingAsk,
  [recording.recordingCancelAsk.name]: recording.recordingCancelAsk,
  [recording.recordingDismissQuestion.name]: recording.recordingDismissQuestion,
  [chat.chatSend.name]: chat.chatSend,
  [chat.chatCancel.name]: chat.chatCancel,
  [chat.chatNewChat.name]: chat.chatNewChat,
  [chat.chatState.name]: chat.chatState,
  [chat.chatSetScope.name]: chat.chatSetScope,
  [chat.chatMeetingExists.name]: chat.chatMeetingExists,
  [chat.chatCopyText.name]: chat.chatCopyText,
  [chat.chatOpenExternal.name]: chat.chatOpenExternal,
  [chat.chatAttachPick.name]: chat.chatAttachPick,
  [chat.chatAttachDrop.name]: chat.chatAttachDrop,
  [chat.chatAttachRemove.name]: chat.chatAttachRemove,
  [chat.chatAttachList.name]: chat.chatAttachList,
  [chat.chatPromptsList.name]: chat.chatPromptsList,
  [chat.chatPromptsCreate.name]: chat.chatPromptsCreate,
  [chat.chatPromptsUpdate.name]: chat.chatPromptsUpdate,
  [chat.chatPromptsDelete.name]: chat.chatPromptsDelete,
  [chat.chatPromptsExport.name]: chat.chatPromptsExport,
  [chat.chatPromptsImport.name]: chat.chatPromptsImport,
  [liveCopilot.pillTogglePause.name]: liveCopilot.pillTogglePause,
  [liveCopilot.pillStop.name]: liveCopilot.pillStop,
  [liveCopilot.pillOpenApp.name]: liveCopilot.pillOpenApp,
  [liveCopilot.pillSetExpanded.name]: liveCopilot.pillSetExpanded,
  [liveCopilot.pillReady.name]: liveCopilot.pillReady,
  [session.sessionGetView.name]: session.sessionGetView,
  [session.sessionRename.name]: session.sessionRename,
  [session.sessionRevealFile.name]: session.sessionRevealFile,
} as const;

export const eventChannels = {
  [appFocusChanged.name]: appFocusChanged,
  [library.libraryChanged.name]: library.libraryChanged,
  [library.workspaceChanged.name]: library.workspaceChanged,
  [library.workspaceNavigationRequested.name]: library.workspaceNavigationRequested,
  [library.workspaceMeetingDeleted.name]: library.workspaceMeetingDeleted,
  [library.workspaceMeetingChanged.name]: library.workspaceMeetingChanged,
  [library.workspaceTakeNotesRequested.name]: library.workspaceTakeNotesRequested,
  [meetingPrompt.workspaceCallPromptOffered.name]: meetingPrompt.workspaceCallPromptOffered,
  [meetingPrompt.workspaceCallPromptClosed.name]: meetingPrompt.workspaceCallPromptClosed,
  [meetingPrompt.meetingPromptShow.name]: meetingPrompt.meetingPromptShow,
  [meetingPrompt.meetingPromptHide.name]: meetingPrompt.meetingPromptHide,
  [meetingPrompt.settingsMeetingPopupChanged.name]: meetingPrompt.settingsMeetingPopupChanged,
  [settings.settingsModelEvent.name]: settings.settingsModelEvent,
  [settings.i18nLocaleChanged.name]: settings.i18nLocaleChanged,
  [audio.audioSourcesChanged.name]: audio.audioSourcesChanged,
  [audio.audioPreviewLevel.name]: audio.audioPreviewLevel,
  [audio.audioRecordingLevel.name]: audio.audioRecordingLevel,
  [audio.audioRecordingNotice.name]: audio.audioRecordingNotice,
  [transcription.transcriptionStatusChanged.name]: transcription.transcriptionStatusChanged,
  [transcription.transcriptionInstallProgress.name]: transcription.transcriptionInstallProgress,
  [transcription.transcriptionLiveUpdate.name]: transcription.transcriptionLiveUpdate,
  [transcription.retranscriptionStateChanged.name]: transcription.retranscriptionStateChanged,
  [transcription.retranscriptionFinished.name]: transcription.retranscriptionFinished,
  [summaries.summariesProgress.name]: summaries.summariesProgress,
  [liveCopilot.pillStateChanged.name]: liveCopilot.pillStateChanged,
  [liveCopilot.pillHint.name]: liveCopilot.pillHint,
  [recording.recordingStateChanged.name]: recording.recordingStateChanged,
  [recording.recordingCloseRequest.name]: recording.recordingCloseRequest,
  [recording.recordingLiveText.name]: recording.recordingLiveText,
  [recording.recordingAnswer.name]: recording.recordingAnswer,
  [recording.recordingQuestionDetected.name]: recording.recordingQuestionDetected,
  [recording.recordingQuestionWithdrawn.name]: recording.recordingQuestionWithdrawn,
  [chat.chatChunk.name]: chat.chatChunk,
  [chat.chatStateChanged.name]: chat.chatStateChanged,
  [chat.chatPromptsChanged.name]: chat.chatPromptsChanged,
} as const;

export type RequestChannels = typeof requestChannels;
export type EventChannels = typeof eventChannels;
export type RequestName = keyof RequestChannels;
export type EventName = keyof EventChannels;
