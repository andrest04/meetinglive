import { describe, expect, it, vi } from 'vitest';
import {
  MeetingFormatError,
  Workspace,
  type Logger,
  type MeetingRecord,
  type RevealPort,
} from '@vozella/core';
import type { IpcEventLike } from '../security/trusted-origin';
import type { IpcMainLike } from './ipc-server';
import { registerSessionHandlers } from './session-handlers';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const ID_A = '11111111-1111-1111-1111-111111111111';

function meeting(patch: Partial<MeetingRecord> = {}): MeetingRecord {
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

const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};

function setup(
  initial: MeetingRecord | null,
  opts: {
    running?: { isRunning: boolean; meetingId: string | null };
    files?: Set<string>;
    getFails?: boolean;
  } = {},
) {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  let stored = initial;
  const saved: MeetingRecord[] = [];
  const meetings = {
    get: (): Promise<MeetingRecord | null> =>
      opts.getFails ? Promise.reject(new MeetingFormatError('bad')) : Promise.resolve(stored),
    save: (r: MeetingRecord): Promise<MeetingRecord> => {
      stored = r;
      saved.push(r);
      return Promise.resolve(r);
    },
  };
  const workspace = new Workspace();
  const changed: string[] = [];
  workspace.on('meetingChanged', (id) => changed.push(id));
  const revealed: string[] = [];
  const reveal: RevealPort = {
    reveal: (p) => {
      revealed.push(p);
    },
  };
  const files = opts.files ?? new Set<string>();
  registerSessionHandlers({
    server: { ipc, isTrusted: () => true, logger: logger() },
    meetings,
    workspace,
    runnerState: () => opts.running ?? { isRunning: false, meetingId: null },
    fileExists: (p) => files.has(p),
    reveal,
  });
  const call = async (name: string, input: unknown) =>
    (await handlers.get(name)?.(event as never, input)) as {
      ok: boolean;
      value?: Record<string, unknown>;
    };
  return { call, saved, changed, revealed };
}

describe('session.getView', () => {
  it('reports transcript and audio from the record and the disk', async () => {
    const rec = meeting({ transcript: 'hola', audioFilePath: 'C:/a.wav' });
    const t = setup(rec, { files: new Set(['C:/a.wav']) });
    const r = await t.call('session.getView', { id: ID_A });
    expect(r.value).toMatchObject({ hasTranscript: true, hasAudio: true });
    expect((r.value?.record as MeetingRecord).id).toBe(ID_A);
  });

  it('treats a missing or zero-byte audio file as no audio (B20)', async () => {
    const t = setup(meeting({ transcript: ' ', audioFilePath: 'C:/a.wav' }));
    const r = await t.call('session.getView', { id: ID_A });
    expect(r.value).toMatchObject({ hasTranscript: false, hasAudio: false });
  });

  it('returns an empty view for a missing meeting or an unreadable file', async () => {
    const missing = await setup(null).call('session.getView', { id: ID_A });
    expect(missing.value).toEqual({ record: null, hasTranscript: false, hasAudio: false });
    const bad = await setup(meeting(), { getFails: true }).call('session.getView', { id: ID_A });
    expect(bad.value).toMatchObject({ record: null });
  });
});

describe('session.rename', () => {
  it('saves the trimmed title and raises meetingChanged (B11)', async () => {
    const t = setup(meeting({ title: 'Old' }));
    const r = await t.call('session.rename', { id: ID_A, title: '  New  ' });
    expect(r.value).toEqual({ status: 'renamed' });
    expect(t.saved[0]?.title).toBe('New');
    expect(t.changed).toEqual([ID_A]);
  });

  it('is blocked while a run targets that meeting (B4), not for another one', async () => {
    const running = { isRunning: true, meetingId: ID_A };
    const blocked = setup(meeting(), { running });
    expect((await blocked.call('session.rename', { id: ID_A, title: 'X' })).value).toEqual({
      status: 'blocked',
    });
    expect(blocked.saved).toEqual([]);
    const other = setup(meeting(), { running: { isRunning: true, meetingId: 'other' } });
    expect((await other.call('session.rename', { id: ID_A, title: 'X' })).value).toEqual({
      status: 'renamed',
    });
  });

  it('reports unchanged and missing without writing', async () => {
    const same = setup(meeting({ title: 'Same' }));
    expect((await same.call('session.rename', { id: ID_A, title: 'Same' })).value).toEqual({
      status: 'unchanged',
    });
    expect(same.changed).toEqual([]);
    const none = setup(null);
    expect((await none.call('session.rename', { id: ID_A, title: 'X' })).value).toEqual({
      status: 'missing',
    });
  });
});

describe('session.revealFile', () => {
  it('reveals the markdown file when it exists', async () => {
    const t = setup(meeting({ sourcePath: 'C:/m/a.md' }), {
      files: new Set(['C:/m/a.md']),
    });
    expect((await t.call('session.revealFile', { id: ID_A })).value).toEqual({ revealed: true });
    expect(t.revealed).toEqual(['C:/m/a.md']);
  });

  it('returns revealed false for a missing meeting, path or file (B13)', async () => {
    for (const t of [
      setup(null),
      setup(meeting({ sourcePath: null })),
      setup(meeting({ sourcePath: 'C:/gone.md' })),
    ]) {
      expect((await t.call('session.revealFile', { id: ID_A })).value).toEqual({
        revealed: false,
      });
      expect(t.revealed).toEqual([]);
    }
  });
});
