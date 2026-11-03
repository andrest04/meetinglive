import { describe, expect, it } from 'vitest';
import { createAppPaths } from './app-paths';

// Core has no Node dependency; a backslash joiner is enough to check the layout.
const win = { join: (...parts: string[]) => parts.join(String.fromCharCode(92)) };
const paths = createAppPaths({ appData: 'C:\\Local\\App', library: 'C:\\Docs\\Library' }, win);

describe('createAppPaths', () => {
  it('puts Inbox, the legacy dumps and folders.json under the Library root', () => {
    expect(paths.userDataDirectory).toBe('C:\\Docs\\Library');
    expect(paths.inboxDirectory).toBe('C:\\Docs\\Library\\Inbox');
    expect(paths.meetingsDirectory).toBe('C:\\Docs\\Library\\Meetings');
    expect(paths.recordingsDirectory).toBe('C:\\Docs\\Library\\Recordings');
    expect(paths.foldersFilePath).toBe('C:\\Docs\\Library\\folders.json');
  });

  it('puts settings, credentials and the first-generation files under the app data root', () => {
    expect(paths.rootDirectory).toBe('C:\\Local\\App');
    expect(paths.settingsFilePath).toBe('C:\\Local\\App\\settings.json');
    expect(paths.xaiCredentialsFilePath).toBe('C:\\Local\\App\\xai-credentials.bin');
    expect(paths.typeSafeCredentialsFilePath).toBe('C:\\Local\\App\\typesafe-credentials.bin');
    expect(paths.meetingsFilePath).toBe('C:\\Local\\App\\meetings.json');
    expect(paths.legacyMeetingsDirectory).toBe('C:\\Local\\App\\Meetings');
    expect(paths.legacyRecordingsDirectory).toBe('C:\\Local\\App\\Recordings');
    expect(paths.legacyFoldersFilePath).toBe('C:\\Local\\App\\folders.json');
  });

  it('keeps the exact names other modules rely on', () => {
    expect(paths.modelsDirectory).toBe('C:\\Local\\App\\Models');
    expect(paths.transcriptionModelsDirectory).toBe('C:\\Local\\App\\TranscriptionModels');
    expect(paths.nemoSpeechDirectory).toBe('C:\\Local\\App\\NemoSpeech');
    expect(paths.summaryModelsDirectory).toBe('C:\\Local\\App\\SummaryModels');
    expect(paths.chatThreadsFilePath).toBe('C:\\Local\\App\\chat-threads.json');
    expect(paths.chatRecipesFilePath).toBe('C:\\Local\\App\\chat-recipes.json');
    expect(paths.customNoteTemplateFilePath).toBe('C:\\Local\\App\\custom-note-template.json');
  });
});
