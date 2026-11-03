import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventChannel } from '@vozella/contracts';
import { MeetingBusyRegistry, Workspace, type Logger } from '@vozella/core';
import { FakeClock, LibraryRuntime } from '@vozella/platform';
import type { IpcEventLike } from '../security/trusted-origin';
import type { IpcMainLike } from './ipc-server';
import { applyWorkspaceAction, bridgeWorkspace, registerLibraryHandlers } from './library-handlers';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};
const ID = '11111111-1111-1111-1111-111111111111';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-handlers-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const busy = new MeetingBusyRegistry();
  const runtime = new LibraryRuntime({
    mode: 'test',
    roots: { appData: path.join(dir, 'app'), meetings: path.join(dir, 'meetings'), source: 'env' },
    guard: {
      localAppData: path.join(dir, 'fake-local'),
      documents: path.join(dir, 'fake-docs'),
      tempDir: os.tmpdir(),
    },
    logger: logger(),
    clock: new FakeClock('2026-09-05T15:00:00Z'),
    newId: () => crypto.randomUUID(),
    busy,
    openPath: () => Promise.resolve(''),
    pickFolder: () => Promise.resolve(null),
    version: '1.0.0.0',
  });
  await runtime.start();
  const workspace = new Workspace();
  const events: { name: string; payload: unknown }[] = [];
  const broadcast = (channel: EventChannel, payload: unknown) => {
    events.push({ name: channel.name, payload });
  };
  const writes = registerLibraryHandlers({
    server: { ipc, isTrusted: () => true, logger: logger() },
    runtime,
    workspace,
    broadcast,
  });
  bridgeWorkspace(workspace, broadcast);
  const call = async (name: string, input: unknown = {}) =>
    (await handlers.get(name)?.(event as never, input)) as {
      ok: boolean;
      value?: Record<string, unknown>;
      error?: { code: string };
    };
  return { call, events, workspace, busy, runtime, writes };
}

describe('library handlers', () => {
  it('creates a folder, lists it, and tells the windows', async () => {
    const t = await setup();
    const created = await t.call('library.createFolder', { name: 'Trabajo', parentId: null });
    expect(created).toMatchObject({ ok: true, value: { ok: true, folder: { name: 'Trabajo' } } });
    const loaded = await t.call('library.load');
    expect(loaded.value).toMatchObject({ ok: true, folders: [{ name: 'Trabajo' }], meetings: [] });
    expect(t.events.map((e) => e.name)).toContain('library.changed');
  });

  it('lets a quit wait for a folder note that is still being written (B16)', async () => {
    const t = await setup();
    const created = await t.call('library.createFolder', { name: 'Trabajo', parentId: null });
    const id = (created.value as { folder: { id: string } }).folder.id;
    // Not awaited: the window is closing while the write is in flight.
    const inFlight = t.call('library.setFolderNote', { id, note: 'Keep this' });
    await t.writes.settled();
    const loaded = await t.call('library.load');
    expect(loaded.value).toMatchObject({ folders: [{ id, note: 'Keep this' }] });
    await inFlight;
    await expect(t.writes.settled()).resolves.toBeUndefined();
  });

  it('reports a duplicate name as a value', async () => {
    const t = await setup();
    await t.call('library.createFolder', { name: 'A', parentId: null });
    const dup = await t.call('library.createFolder', { name: 'a', parentId: null });
    expect(dup).toMatchObject({ ok: true, value: { ok: false, reason: 'name-taken' } });
  });

  it('moves and deletes a meeting, clears the workspace, and refuses busy ones', async () => {
    const t = await setup();
    const saved = await t.runtime.meetings.save({
      id: ID,
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
      transcript: 'hello',
      summary: null,
      actionItems: [],
      jevAnalysis: null,
      notes: null,
      followUp: null,
      projectPlan: null,
    });
    t.workspace.selectMeeting(ID);

    const full = await t.call('library.getMeeting', { id: ID });
    expect(full.value).toMatchObject({ record: { id: ID, transcript: 'hello' } });
    expect(
      await t.call('library.getMeeting', { id: '22222222-2222-2222-2222-222222222222' }),
    ).toMatchObject({
      value: { record: null },
    });

    const off = t.busy.register({ isBusy: (id) => id === ID });
    expect(await t.call('library.isMeetingBusy', { meetingId: ID })).toMatchObject({
      value: { busy: true },
    });
    expect(await t.call('library.deleteMeeting', { meetingId: ID })).toMatchObject({
      value: { ok: false, reason: 'busy' },
    });
    expect(fs.existsSync(saved.sourcePath ?? '')).toBe(true);
    off();

    expect(await t.call('library.deleteMeeting', { meetingId: ID })).toMatchObject({
      value: { ok: true },
    });
    expect(fs.existsSync(saved.sourcePath ?? '')).toBe(false);
    expect(t.workspace.state.selectedMeetingId).toBeNull();
    expect(t.events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['workspace.meetingDeleted', 'library.changed', 'workspace.changed']),
    );
  });

  it('deleting a folder resets the published folder to Inbox', async () => {
    const t = await setup();
    const created = await t.call('library.createFolder', { name: 'A', parentId: null });
    const id = (created.value as { folder: { id: string } }).folder.id;
    t.workspace.publishSelectedFolder(id);
    expect(await t.call('library.deleteFolder', { id })).toMatchObject({ value: { ok: true } });
    expect(t.workspace.state.selectedFolderId).toBeNull();
  });

  it('reads and patches settings, keeping other fields', async () => {
    const t = await setup();
    expect((await t.call('settings.get')).value).toMatchObject({
      typeSafeEnabled: true,
      uiLanguage: null,
    });
    await t.call('settings.update', { patch: { uiLanguage: 'en' } });
    await t.call('settings.update', { patch: { summaryLanguage: 'en' } });
    expect((await t.call('settings.get')).value).toMatchObject({
      uiLanguage: 'en',
      summaryLanguage: 'en',
    });
    expect((await t.call('settings.update', { patch: { bogus: 1 } })).error?.code).toBe(
      'invalid-input',
    );
  });

  it('reports the location and refuses a MeetingLive folder in test mode', async () => {
    const t = await setup();
    expect((await t.call('library.getLocation')).value).toMatchObject({
      libraryRoot: path.join(dir, 'meetings'),
      appDataRoot: path.join(dir, 'app'),
      version: '1.0.0.0',
    });
    const refused = await t.call('library.setLocation', {
      path: path.join(dir, 'x', 'MeetingLive'),
    });
    expect(refused.value).toMatchObject({ status: 'refused', reason: 'forbidden' });
    expect(await t.call('library.chooseLocation')).toMatchObject({
      value: { status: 'cancelled' },
    });
    expect(await t.call('library.openFolder')).toMatchObject({ value: { opened: true } });
  });
});

describe('workspace channels', () => {
  it('dispatches actions and returns the new state', async () => {
    const t = await setup();
    const result = await t.call('workspace.dispatch', {
      action: { type: 'openSession', tab: 'Summary' },
    });
    expect(result.value).toMatchObject({ state: { sessionTab: 'Summary' } });
    expect(t.events).toContainEqual({
      name: 'workspace.navigationRequested',
      payload: { tag: 'Session' },
    });
    expect((await t.call('workspace.getState')).value).toMatchObject({ sessionTab: 'Summary' });
  });

  it('rejects a bad tag at the wire, before the workspace sees it', async () => {
    const t = await setup();
    const result = await t.call('workspace.dispatch', {
      action: { type: 'navigateTo', tag: 'Transcript' },
    });
    expect(result.error?.code).toBe('invalid-input');
  });

  it('take-notes request and consume', async () => {
    const t = await setup();
    await t.call('workspace.dispatch', {
      action: { type: 'requestTakeNotes', calendarEventId: 'evt' },
    });
    const first = await t.call('workspace.dispatch', { action: { type: 'consumeTakeNotes' } });
    expect(first.value).toMatchObject({ takeNotes: { pending: true, calendarEventId: 'evt' } });
    const second = await t.call('workspace.dispatch', { action: { type: 'consumeTakeNotes' } });
    expect(second.value).toMatchObject({ takeNotes: { pending: false, calendarEventId: null } });
  });

  it('applyWorkspaceAction covers every action type', () => {
    const w = new Workspace();
    const actions = [
      { type: 'selectMeeting', id: 'm' },
      { type: 'setLastProcessed', id: 'm' },
      { type: 'setSessionTab', tab: 'Summary' },
      { type: 'setCurrentShellTag', tag: 'History' },
      { type: 'publishSelectedFolder', folderId: 'f' },
      { type: 'setLiveTranscript', text: 'hi' },
      { type: 'setCaptureActive', active: true },
      { type: 'clearSelection' },
      { type: 'notifyMeetingChanged', id: 'm' },
      { type: 'navigateTo', tag: 'Settings' },
    ] as const;
    for (const action of actions) applyWorkspaceAction(w, action);
    expect(w.state).toMatchObject({
      sessionTab: 'Summary',
      currentShellTag: 'History',
      selectedFolderId: 'f',
      liveTranscript: 'hi',
      isCaptureActive: true,
      selectedMeetingId: null,
    });
  });
});
