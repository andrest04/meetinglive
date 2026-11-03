/**
 * The blocks of the Settings page, top to bottom (spec 2.0), and who owns each. The page is a
 * frame: it draws these in order and each owner mounts its own content in its slot. A `slot`
 * block has no content until its module lands; the page shows nothing in its place.
 */

export type SettingsSectionId =
  | 'appearance'
  | 'language'
  | 'summaryProvider'
  | 'typeSafe'
  | 'microphone'
  | 'meetingLanguage'
  | 'transcription'
  | 'recording'
  | 'calendar'
  | 'data'
  | 'about';

export interface SettingsSection {
  readonly id: SettingsSectionId;
  /** Catalog key of the heading, or null when the block is a single row with its own header. */
  readonly headingKey: string | null;
  /** The module spec that owns the content and the fields it writes. */
  readonly owner: string;
  /** `built`: the services behind it exist. `slot`: waiting for its module. */
  readonly status: 'built' | 'slot';
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // The theme is a shell setting, not part of the WinUI page; it keeps its place at the top.
  { id: 'appearance', headingKey: 'Ui_Appearance', owner: 'shell-platform', status: 'built' },
  { id: 'language', headingKey: 'Settings_Language.Text', owner: 'settings-i18n', status: 'built' },
  {
    id: 'summaryProvider',
    headingKey: 'Settings_SummaryProvider.Text',
    owner: 'settings-i18n',
    status: 'built',
  },
  { id: 'typeSafe', headingKey: 'Settings_TypeSafe.Text', owner: 'jev-typesafe', status: 'slot' },
  {
    id: 'microphone',
    headingKey: 'Settings_Microphone.Text',
    owner: 'audio-capture',
    status: 'built',
  },
  {
    id: 'meetingLanguage',
    headingKey: 'Settings_MeetingLanguage.Text',
    owner: 'settings-i18n',
    status: 'built',
  },
  {
    id: 'transcription',
    headingKey: 'Settings_Transcription.Text',
    owner: 'transcription',
    status: 'built',
  },
  { id: 'recording', headingKey: 'Settings_Recording.Text', owner: 'recording', status: 'slot' },
  {
    id: 'calendar',
    headingKey: 'Settings_Calendar.Text',
    owner: 'calendar-detection',
    status: 'slot',
  },
  { id: 'data', headingKey: 'Settings_Data.Text', owner: 'library-storage', status: 'built' },
  { id: 'about', headingKey: null, owner: 'library-storage', status: 'built' },
];

/**
 * Catalog keys the Settings page uses that have no WinUI equivalent, so the page names them from
 * one place. All are in `locales/ui.{en,es}.json`.
 */
export const SETTINGS_MESSAGE_KEYS = {
  loadFailed: 'Ui_SettingsLoadFailed',
  loading: 'Ui_SettingsLoading',
  saveFailed: 'Ui_SettingsSaveFailed',
  recovered: 'Ui_SettingsRecovered',
  modelDownloadFailed: 'Ui_ModelDownloadFailed',
  modelDeleteFailed: 'Ui_ModelDeleteFailed',
  modelDeleteBusy: 'Ui_ModelDeleteBusy',
  modelMissing: 'Ui_ModelMissing',
  modelCancelDownload: 'Ui_ModelCancelDownload',
  restartFailed: 'Ui_RestartFailed',
  cliCheckAgain: 'Ui_CliCheckAgain',
  xaiRetry: 'Ui_XaiRetry',
  /** Accessible names the WinUI page wrote in English only (B16). The owning modules use them. */
  micLevelName: 'Ui_MicLevelName',
  engineDownloadProgressName: 'Ui_EngineDownloadProgressName',
  speakerDownloadProgressName: 'Ui_SpeakerDownloadProgressName',
} as const;
