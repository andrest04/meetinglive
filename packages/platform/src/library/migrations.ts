import fs from 'node:fs/promises';
import nodePath from 'node:path';
import {
  MeetingFormatError,
  parseGuid,
  parseMeetingMarkdown,
  normalizeOffsetDate,
  stripBom,
  type ActionItem,
  type AppPaths,
  type JevAnalysis,
  type Logger,
  type MeetingRecord,
} from '@vozella/core';
import { writeFileAtomic } from '../fs/atomic-write';
import { errorCode, exists, isUnder, moveFile, samePath } from './library-layout';
import type { MarkdownMeetingRepository } from './markdown-meeting-repository';
import type { JsonFolderRepository } from './json-folder-repository';
import { existsSync } from 'node:fs';

async function listFiles(directory: string, extension?: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && (!extension || e.name.toLowerCase().endsWith(extension)))
      .map((e) => nodePath.join(directory, e.name));
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return [];
    throw error;
  }
}

async function removeIfEmpty(directory: string): Promise<void> {
  try {
    await fs.rmdir(directory);
  } catch {
    // Not empty, missing, or in use: all fine.
  }
}

// ---------------------------------------------------------------------------
// 1. User data location (spec 3.16): app data root -> Library root

/** Rewrites the first `audioFilePath: ` line; returns null when it is not under `legacyDir`. */
export function rewriteAudioFilePathLine(
  markdown: string,
  legacyRecordings: string,
  newRecordings: string,
): string | null {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(newline);
  const at = lines.findIndex((line) => line.startsWith('audioFilePath: '));
  if (at < 0) return null;
  const stored = (lines[at] ?? '').slice('audioFilePath: '.length).trim();
  if (stored === '' || !isUnder(stored, legacyRecordings)) return null;
  lines[at] = `audioFilePath: ${nodePath.join(newRecordings, nodePath.win32.basename(stored))}`;
  return lines.join('\n');
}

/**
 * Moves the first-generation files from the app data root into the Library root, never
 * overwriting. B11: nothing is created unless there is something to move, so a clean install
 * leaves no empty `Meetings` and `Recordings` folders behind.
 */
export async function migrateUserDataLocation(paths: AppPaths, logger?: Logger): Promise<void> {
  const same =
    nodePath.resolve(paths.legacyMeetingsDirectory) === nodePath.resolve(paths.meetingsDirectory) &&
    nodePath.resolve(paths.legacyRecordingsDirectory) ===
      nodePath.resolve(paths.recordingsDirectory) &&
    nodePath.resolve(paths.legacyFoldersFilePath) === nodePath.resolve(paths.foldersFilePath);
  if (same) return;

  for (const [from, to] of [
    [paths.legacyMeetingsDirectory, paths.meetingsDirectory],
    [paths.legacyRecordingsDirectory, paths.recordingsDirectory],
  ] as const) {
    for (const file of await listFiles(from)) {
      const target = nodePath.join(to, nodePath.basename(file));
      if (await exists(target)) {
        logger?.info('left a legacy file in place: the destination exists', { file });
        continue;
      }
      await moveFile(file, target);
    }
  }

  if ((await exists(paths.legacyFoldersFilePath)) && !(await exists(paths.foldersFilePath))) {
    await moveFile(paths.legacyFoldersFilePath, paths.foldersFilePath);
  }

  for (const file of await listFiles(paths.meetingsDirectory, '.md')) {
    const text = await fs.readFile(file, 'utf8');
    const rewritten = rewriteAudioFilePathLine(
      stripBom(text),
      paths.legacyRecordingsDirectory,
      paths.recordingsDirectory,
    );
    if (rewritten !== null) await writeFileAtomic(file, rewritten);
  }

  await removeIfEmpty(paths.legacyMeetingsDirectory);
  await removeIfEmpty(paths.legacyRecordingsDirectory);
}

// ---------------------------------------------------------------------------
// 2. Library layout: flat `Library/Meetings` dump -> folder directories

export interface LayoutMigrationDeps {
  readonly paths: AppPaths;
  readonly meetings: MarkdownMeetingRepository;
  readonly folders: JsonFolderRepository;
  readonly logger?: Logger;
}

const probe = { fileExists: (path: string): boolean => existsSync(path) };

export async function migrateLibraryLayout(deps: LayoutMigrationDeps): Promise<void> {
  const { paths, meetings, logger } = deps;
  if (!(await exists(paths.meetingsDirectory))) return;

  const files = await listFiles(paths.meetingsDirectory, '.md');
  if (files.length === 0) {
    await removeIfEmpty(paths.meetingsDirectory);
    await removeIfEmpty(paths.recordingsDirectory);
    return;
  }

  for (const file of files) {
    let record: MeetingRecord;
    try {
      record = parseMeetingMarkdown(file, await fs.readFile(file, 'utf8'), probe);
    } catch (error) {
      if (error instanceof MeetingFormatError) {
        logger?.warn('layout migration skipped an unreadable file', { file });
        continue;
      }
      throw error;
    }

    // B12: a current-layout copy of this meeting wins; legacy content never overwrites it.
    const copies = await meetings.locate(record.id);
    // B10: the file of a WinUI user folder named Meetings or Recordings is not a dump.
    if (copies.find((c) => samePath(c.path, file))?.legacy === false) continue;
    if (copies.some((c) => !c.legacy)) {
      logger?.warn('layout migration dropped a legacy copy: a newer one exists', { id: record.id });
      await fs.unlink(file);
      continue;
    }

    const orphan = nodePath.join(paths.recordingsDirectory, `${record.id}.wav`);
    const audioMissing =
      record.audioFilePath.trim() === '' || !(await exists(record.audioFilePath));
    await meetings.save(
      audioMissing && (await exists(orphan)) ? { ...record, audioFilePath: orphan } : record,
    );
  }

  await removeIfEmpty(paths.meetingsDirectory);
  await removeIfEmpty(paths.recordingsDirectory);
}

// ---------------------------------------------------------------------------
// 3. Legacy `meetings.json`

type LegacyJson = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function requiredString(entry: LegacyJson, key: string, index: number): string {
  const value = entry[key];
  if (typeof value !== 'string') throw new Error(`meetings.json entry ${index} lacks "${key}"`);
  return value;
}

function legacyToRecord(entry: LegacyJson, index: number): MeetingRecord {
  const id = parseGuid(requiredString(entry, 'id', index));
  const recordedAt = normalizeOffsetDate(requiredString(entry, 'recordedAt', index));
  if (id === null || recordedAt === null) {
    throw new Error(`meetings.json entry ${index} has an invalid id or recordedAt`);
  }
  const endedText = str(entry.endedAt);
  const items = Array.isArray(entry.actionItems) ? (entry.actionItems as LegacyJson[]) : [];
  const actionItems: ActionItem[] = items.map((a) => ({
    text: typeof a.text === 'string' ? a.text : '',
    isDone: a.isDone === true,
  }));
  return {
    id,
    title: requiredString(entry, 'title', index),
    recordedAt,
    endedAt: endedText === null ? null : normalizeOffsetDate(endedText),
    audioFilePath: requiredString(entry, 'audioFilePath', index),
    sourcePath: null,
    folderId: parseGuid(str(entry.folderId)),
    summaryProvider: str(entry.summaryProvider),
    calendarEventId: str(entry.calendarEventId),
    calendarId: str(entry.calendarId),
    seriesId: str(entry.seriesId),
    joinUrl: str(entry.joinUrl),
    noteTemplateId: str(entry.noteTemplateId),
    attendees: Array.isArray(entry.attendees)
      ? (entry.attendees as unknown[]).filter((a): a is string => typeof a === 'string')
      : [],
    brief: str(entry.brief),
    transcript: str(entry.transcript),
    summary: str(entry.summary),
    actionItems,
    jevAnalysis:
      typeof entry.jevAnalysis === 'object' && entry.jevAnalysis !== null
        ? (entry.jevAnalysis as JevAnalysis)
        : null,
    notes: str(entry.notes),
    followUp: str(entry.followUp),
    projectPlan: str(entry.projectPlan),
  };
}

/** `meetings.json.bak`, then `.bak.1`, `.bak.2`, ... Never overwrites an earlier backup. */
async function freeBackupName(file: string): Promise<string> {
  let target = `${file}.bak`;
  for (let n = 1; await exists(target); n += 1) target = `${file}.bak.${n}`;
  return target;
}

/**
 * Imports `meetings.json` records that are not in the library yet, then renames the file to a
 * backup. Existing meetings are left alone (they may hold newer edits). A damaged file throws
 * and the source stays, so the next launch tries again.
 */
export async function migrateLegacyMeetingsJson(
  paths: AppPaths,
  meetings: MarkdownMeetingRepository,
): Promise<void> {
  if (!(await exists(paths.meetingsFilePath))) return;
  const parsed: unknown = JSON.parse(stripBom(await fs.readFile(paths.meetingsFilePath, 'utf8')));
  if (!Array.isArray(parsed)) throw new Error('meetings.json is not a JSON array');
  const records = (parsed as LegacyJson[]).map(legacyToRecord);

  const present = new Set((await meetings.list()).items.map((i) => i.id));
  for (const record of records) {
    if (!present.has(record.id)) await meetings.save(record);
  }
  await fs.rename(paths.meetingsFilePath, await freeBackupName(paths.meetingsFilePath));
}

// ---------------------------------------------------------------------------

export interface StartupMigrationResult {
  /** The first failure. Later migrations were skipped (spec 2.18). */
  readonly error: string | null;
}

/** Runs the three migrations in order; the first error stops the rest and is returned. */
export async function runStartupMigrations(
  deps: LayoutMigrationDeps,
): Promise<StartupMigrationResult> {
  try {
    await migrateUserDataLocation(deps.paths, deps.logger);
    await migrateLibraryLayout(deps);
    await migrateLegacyMeetingsJson(deps.paths, deps.meetings);
    return { error: null };
  } catch (error) {
    deps.logger?.error('startup migration failed', { error });
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
