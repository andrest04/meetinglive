import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';
import * as audio from './audio';
import * as library from './library';
import * as settings from './settings';

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
  [settings.settingsXaiRefresh.name]: settings.settingsXaiRefresh,
  [settings.settingsXaiSaveApiKey.name]: settings.settingsXaiSaveApiKey,
  [settings.settingsXaiSignOut.name]: settings.settingsXaiSignOut,
  [settings.settingsXaiSignIn.name]: settings.settingsXaiSignIn,
  [settings.i18nGetLocale.name]: settings.i18nGetLocale,
  [settings.appRestart.name]: settings.appRestart,
  [audio.audioMicrophonesLoad.name]: audio.audioMicrophonesLoad,
  [audio.audioMicrophonesRemember.name]: audio.audioMicrophonesRemember,
  [audio.audioSourcesStart.name]: audio.audioSourcesStart,
  [audio.audioSourcesStop.name]: audio.audioSourcesStop,
  [audio.audioSourcesSelect.name]: audio.audioSourcesSelect,
  [audio.audioSourcesDismissSuggestion.name]: audio.audioSourcesDismissSuggestion,
  [audio.audioSourcesCloseFallback.name]: audio.audioSourcesCloseFallback,
  [audio.audioPreviewStart.name]: audio.audioPreviewStart,
  [audio.audioPreviewStop.name]: audio.audioPreviewStop,
  [audio.audioImportPickFile.name]: audio.audioImportPickFile,
} as const;

export const eventChannels = {
  [appFocusChanged.name]: appFocusChanged,
  [library.libraryChanged.name]: library.libraryChanged,
  [library.workspaceChanged.name]: library.workspaceChanged,
  [library.workspaceNavigationRequested.name]: library.workspaceNavigationRequested,
  [library.workspaceMeetingDeleted.name]: library.workspaceMeetingDeleted,
  [library.workspaceMeetingChanged.name]: library.workspaceMeetingChanged,
  [library.workspaceTakeNotesRequested.name]: library.workspaceTakeNotesRequested,
  [settings.settingsModelEvent.name]: settings.settingsModelEvent,
  [settings.i18nLocaleChanged.name]: settings.i18nLocaleChanged,
  [audio.audioSourcesChanged.name]: audio.audioSourcesChanged,
  [audio.audioPreviewLevel.name]: audio.audioPreviewLevel,
  [audio.audioRecordingLevel.name]: audio.audioRecordingLevel,
  [audio.audioRecordingNotice.name]: audio.audioRecordingNotice,
} as const;

export type RequestChannels = typeof requestChannels;
export type EventChannels = typeof eventChannels;
export type RequestName = keyof RequestChannels;
export type EventName = keyof EventChannels;
