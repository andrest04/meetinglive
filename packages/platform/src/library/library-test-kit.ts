import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FolderRecord, MeetingRecord } from '@vozella/core';
import { createAppPaths } from '@vozella/core';
import { JsonFolderRepository } from './json-folder-repository';
import { MarkdownMeetingRepository } from './markdown-meeting-repository';

/** Shared setup for the library adapter tests. Every test works in its own temp folder. */
export interface LibraryFixture {
  readonly dir: string;
  readonly root: string;
  readonly appData: string;
  readonly paths: ReturnType<typeof createAppPaths>;
  readonly folders: JsonFolderRepository;
  readonly meetings: MarkdownMeetingRepository;
  cleanup(): void;
}

export function createLibraryFixture(
  options: {
    rename?: (from: string, to: string) => Promise<void>;
    unlink?: (p: string) => Promise<void>;
    discard?: (p: string) => Promise<void>;
  } = {},
): LibraryFixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-lib-'));
  const root = path.join(dir, 'library');
  const appData = path.join(dir, 'app');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  const paths = createAppPaths({ appData, library: root }, path);
  const folders = new JsonFolderRepository({ foldersFilePath: paths.foldersFilePath });
  const meetings = new MarkdownMeetingRepository({ root, folders, ...options });
  return {
    dir,
    root,
    appData,
    paths,
    folders,
    meetings,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const ID_A = '11111111-1111-1111-1111-111111111111';
export const ID_B = '22222222-2222-2222-2222-222222222222';
export const FOLDER_1 = '7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b';
export const FOLDER_2 = '0b8e6f31-5c2a-4d77-9e10-aa11bb22cc33';

export function meeting(patch: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: ID_A,
    title: 'Standup',
    recordedAt: '2026-09-01T12:00:00.0000000+00:00',
    endedAt: null,
    audioFilePath: '',
    sourcePath: null,
    folderId: null,
    summaryProvider: null,
    calendarEventId: null,
    calendarId: null,
    seriesId: null,
    joinUrl: null,
    noteTemplateId: null,
    attendees: [],
    brief: null,
    transcript: null,
    summary: null,
    actionItems: [],
    jevAnalysis: null,
    notes: null,
    followUp: null,
    projectPlan: null,
    ...patch,
  };
}

export function folder(id: string, name: string, parentId: string | null = null): FolderRecord {
  return {
    id,
    name,
    parentId,
    note: null,
    colorKey: null,
    iconKey: null,
    createdAt: '2026-09-01T12:00:00-05:00',
  };
}

/** All files under a folder, relative and sorted, for layout assertions. */
export function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out.sort();
}
