/** Just the path operation the layout needs, so core never imports `node:path`. */
export interface PathJoiner {
  join(...parts: string[]): string;
}

export interface AppPathRoots {
  /** Spec "app data root": settings, models, caches. */
  readonly appData: string;
  /** Spec "Library root": meetings, Inbox, folders.json. */
  readonly library: string;
}

/**
 * Spec 3.1. Names inside the roots are fixed by the file formats, so a library written by the
 * WinUI app opens here unchanged. The roots themselves are chosen by the data-root guard.
 */
export interface AppPaths {
  readonly rootDirectory: string;
  readonly userDataDirectory: string;
  readonly inboxDirectory: string;
  readonly foldersFilePath: string;
  readonly settingsFilePath: string;
  /** Legacy JSON store. */
  readonly meetingsFilePath: string;
  /** Legacy flat markdown dump (second generation). */
  readonly meetingsDirectory: string;
  readonly recordingsDirectory: string;
  /** First generation, under the app data root. */
  readonly legacyMeetingsDirectory: string;
  readonly legacyRecordingsDirectory: string;
  readonly legacyFoldersFilePath: string;
  // Owned by other modules; the names must stay.
  readonly modelsDirectory: string;
  readonly transcriptionModelsDirectory: string;
  readonly nemoSpeechDirectory: string;
  readonly summaryModelsDirectory: string;
  readonly chatThreadsFilePath: string;
  readonly chatRecipesFilePath: string;
  /** Saved chat prompts of this app (Phase 5). The WinUI `chat-recipes.json` is left alone. */
  readonly chatPromptsFilePath: string;
  /** Kept for on-disk compatibility with the WinUI app. Nothing reads or deletes this file (xAI was removed). */
  readonly xaiCredentialsFilePath: string;
  readonly typeSafeCredentialsFilePath: string;
  readonly customNoteTemplateFilePath: string;
}

export function createAppPaths(roots: AppPathRoots, path: PathJoiner): AppPaths {
  const root = roots.appData;
  const library = roots.library;
  return {
    rootDirectory: root,
    userDataDirectory: library,
    inboxDirectory: path.join(library, 'Inbox'),
    foldersFilePath: path.join(library, 'folders.json'),
    settingsFilePath: path.join(root, 'settings.json'),
    meetingsFilePath: path.join(root, 'meetings.json'),
    meetingsDirectory: path.join(library, 'Meetings'),
    recordingsDirectory: path.join(library, 'Recordings'),
    legacyMeetingsDirectory: path.join(root, 'Meetings'),
    legacyRecordingsDirectory: path.join(root, 'Recordings'),
    legacyFoldersFilePath: path.join(root, 'folders.json'),
    modelsDirectory: path.join(root, 'Models'),
    transcriptionModelsDirectory: path.join(root, 'TranscriptionModels'),
    nemoSpeechDirectory: path.join(root, 'NemoSpeech'),
    summaryModelsDirectory: path.join(root, 'SummaryModels'),
    chatThreadsFilePath: path.join(root, 'chat-threads.json'),
    chatRecipesFilePath: path.join(root, 'chat-recipes.json'),
    chatPromptsFilePath: path.join(root, 'chat-prompts.json'),
    xaiCredentialsFilePath: path.join(root, 'xai-credentials.bin'),
    typeSafeCredentialsFilePath: path.join(root, 'typesafe-credentials.bin'),
    customNoteTemplateFilePath: path.join(root, 'custom-note-template.json'),
  };
}
