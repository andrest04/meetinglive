import { MeetingBusyRegistry, Workspace, type Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createRecordingEntryPoints,
  registerRecordingBusyProbe,
  startTakeNotesRequests,
} from './entry-points';
import type { RecordingService } from './recording-service';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeService(over: Partial<Record<string, unknown>> = {}) {
  return {
    start: vi.fn(() => Promise.resolve({ started: true, meetingId: 'm1', recordedAtMs: 1 })),
    stop: vi.fn(() => Promise.resolve(true)),
    isCaptureActive: false,
    isMeetingInUse: vi.fn((id: string) => id === 'busy'),
    processAudioFile: vi.fn(() => ({ started: true, meetingId: 'm9' })),
    ...over,
  };
}

describe('recording entry points', () => {
  it('startRecording uses the remembered sources, the selected folder and an optional meeting', async () => {
    const service = fakeService();
    const workspace = new Workspace();
    workspace.publishSelectedFolder('f1');
    const entry = createRecordingEntryPoints(service as unknown as RecordingService, workspace);
    expect(await entry.startRecording({ meetingId: 'm1' })).toEqual({
      started: true,
      meetingId: 'm1',
    });
    expect(service.start).toHaveBeenCalledWith(
      { title: '', folderId: 'f1', microphone: null, appName: null },
      { meetingId: 'm1' },
    );
  });

  it('reports a refused start without a meeting id', async () => {
    const service = fakeService({
      start: vi.fn(() => Promise.resolve({ started: false, reason: 'busy', message: null })),
    });
    const entry = createRecordingEntryPoints(
      service as unknown as RecordingService,
      new Workspace(),
    );
    expect(await entry.startRecording()).toEqual({ started: false, meetingId: null });
  });

  it('delegates stop, capture state, use and processing', async () => {
    const service = fakeService({ isCaptureActive: true });
    const entry = createRecordingEntryPoints(
      service as unknown as RecordingService,
      new Workspace(),
    );
    expect(await entry.stopRecording()).toBe(true);
    expect(entry.isCaptureActive()).toBe(true);
    expect(entry.isMeetingInUse('busy')).toBe(true);
    expect(entry.processAudioFile(null, 'a.wav', {} as never)).toEqual({
      started: true,
      meetingId: 'm9',
    });
  });

  it('164: the busy registry refuses a meeting the recording holds', () => {
    const entry = createRecordingEntryPoints(
      fakeService() as unknown as RecordingService,
      new Workspace(),
    );
    const registry = new MeetingBusyRegistry();
    registerRecordingBusyProbe(registry, entry);
    expect(registry.isBusy('busy')).toBe(true);
    expect(registry.isBusy('other')).toBe(false);
  });
});

describe('take-notes request (180)', () => {
  it('starts a blank recording once, and an event id does not change that', async () => {
    const service = fakeService();
    const workspace = new Workspace();
    const entry = createRecordingEntryPoints(service as unknown as RecordingService, workspace);
    startTakeNotesRequests(workspace, entry, logger);
    workspace.requestTakeNotes('event-1');
    await vi.waitFor(() => {
      expect(service.start).toHaveBeenCalledTimes(1);
    });
    expect(workspace.consumeTakeNotes().pending).toBe(false);
  });

  it('a busy session answers busy and nothing throws', async () => {
    const service = fakeService({
      start: vi.fn(() => Promise.resolve({ started: false, reason: 'busy', message: null })),
    });
    const workspace = new Workspace();
    startTakeNotesRequests(
      workspace,
      createRecordingEntryPoints(service as unknown as RecordingService, workspace),
      logger,
    );
    workspace.requestTakeNotes();
    await vi.waitFor(() => {
      expect(service.start).toHaveBeenCalled();
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
