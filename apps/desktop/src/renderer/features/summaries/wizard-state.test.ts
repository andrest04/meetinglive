import type { ModelRowDto } from '@vozella/contracts';
import { describe, expect, it } from 'vitest';
import {
  initialWizardState,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from './wizard-state';

const row = (fileName: string, extra: Partial<ModelRowDto> = {}): ModelRowDto => ({
  fileName,
  displayName: fileName,
  fileSizeGb: 1,
  minRamGb: 4,
  speedKey: 'Model_Speed_Fast',
  qualityKey: 'Model_Quality_Good',
  useCaseKey: 'Model_UseCase_Light',
  fit: 'Recommended',
  downloaded: false,
  active: false,
  downloading: false,
  percent: null,
  ...extra,
});

const ROWS = [row('a.gguf'), row('b.gguf', { downloaded: true })];
const HARDWARE = { totalRamGb: 16, gpuName: null, gpuVramGb: null };
const loaded = (attempt: number, defaultFileName: string | null = 'b.gguf'): WizardAction => ({
  type: 'hardwareLoaded',
  attempt,
  hardware: HARDWARE,
  rows: ROWS,
  defaultFileName,
});

const run = (start: WizardState, ...actions: WizardAction[]): WizardState =>
  actions.reduce(wizardReducer, start);

const selecting = (): WizardState => run(initialWizardState('local-only'), loaded(1));

describe('initialWizardState', () => {
  it('choose mode opens on the chooser', () => {
    expect(initialWizardState('choose').phase).toBe('ChoosingEngine');
  });

  it('local-only mode opens directly on hardware detection, never on the chooser (B33)', () => {
    const state = initialWizardState('local-only');
    expect(state.phase).toBe('DetectingHardware');
    expect(state.attempt).toBe(1);
  });
});

describe('wizardReducer', () => {
  it('choosing Local detects hardware under a new attempt', () => {
    const state = run(initialWizardState('choose'), { type: 'chooseEngine', engine: 'Local' });
    expect(state).toMatchObject({ phase: 'DetectingHardware', attempt: 1 });
  });

  it('choosing a CLI moves to CheckingCli with that kind', () => {
    const state = run(initialWizardState('choose'), { type: 'chooseEngine', engine: 'Codex' });
    expect(state).toMatchObject({ phase: 'CheckingCli', cli: 'Codex' });
  });

  it('back from CheckingCli returns to the chooser', () => {
    const state = run(
      initialWizardState('choose'),
      { type: 'chooseEngine', engine: 'ClaudeCode' },
      { type: 'back' },
    );
    expect(state.phase).toBe('ChoosingEngine');
  });

  it('loaded hardware selects the default file (item 128)', () => {
    expect(selecting()).toMatchObject({ phase: 'SelectingModel', selected: 'b.gguf', error: null });
  });

  it('with no default the first row is selected, and with no rows nothing is', () => {
    const first = run(initialWizardState('local-only'), loaded(1, null));
    expect(first).toMatchObject({ selected: 'a.gguf' });
    const none = run(initialWizardState('local-only'), {
      type: 'hardwareLoaded',
      attempt: 1,
      hardware: null,
      rows: [],
      defaultFileName: null,
    });
    expect(none).toMatchObject({ phase: 'SelectingModel', selected: null });
  });

  it('a hardware answer from an older attempt is ignored', () => {
    const state = run(initialWizardState('local-only'), loaded(0));
    expect(state.phase).toBe('DetectingHardware');
  });

  it('a hardware failure stays on detection with the message and retry starts a new attempt', () => {
    const failed = run(initialWizardState('local-only'), {
      type: 'hardwareFailed',
      attempt: 1,
      message: 'boom',
    });
    expect(failed).toMatchObject({ phase: 'DetectingHardware', error: 'boom' });
    const retried = run(failed, { type: 'retryHardware' });
    expect(retried).toMatchObject({ phase: 'DetectingHardware', error: null, attempt: 2 });
  });

  it('selecting a row changes the selection and clears an earlier error', () => {
    const failed = run(
      selecting(),
      { type: 'startDownload', fileName: 'a.gguf' },
      { type: 'downloadFailed', attempt: 2, message: 'offline' },
    );
    expect(failed).toMatchObject({ phase: 'SelectingModel', error: 'offline' });
    const picked = run(failed, { type: 'select', fileName: 'b.gguf' });
    expect(picked).toMatchObject({ selected: 'b.gguf', error: null });
  });

  it('starting a download moves to Downloading at 0 percent under a new attempt', () => {
    const state = run(selecting(), { type: 'startDownload', fileName: 'a.gguf' });
    expect(state).toMatchObject({
      phase: 'Downloading',
      fileName: 'a.gguf',
      percent: 0,
      attempt: 2,
    });
  });

  it('progress for the downloading file moves the percent; other files and lower values do not', () => {
    const start = run(selecting(), { type: 'startDownload', fileName: 'a.gguf' });
    const at40 = run(start, { type: 'progress', fileName: 'a.gguf', percent: 40 });
    expect(at40).toMatchObject({ percent: 40 });
    expect(run(at40, { type: 'progress', fileName: 'b.gguf', percent: 90 })).toBe(at40);
    expect(run(at40, { type: 'progress', fileName: 'a.gguf', percent: 10 })).toBe(at40);
    expect(run(at40, { type: 'progress', fileName: 'a.gguf', percent: 250 })).toMatchObject({
      percent: 100,
    });
  });

  it('a failed download returns to the model list with the error and the same selection (B7)', () => {
    const state = run(
      selecting(),
      { type: 'startDownload', fileName: 'a.gguf' },
      { type: 'downloadFailed', attempt: 2, message: 'offline' },
    );
    expect(state).toMatchObject({
      phase: 'SelectingModel',
      selected: 'a.gguf',
      error: 'offline',
    });
  });

  it('cancelling the download returns to the list at once with no error (B6)', () => {
    const state = run(
      selecting(),
      { type: 'startDownload', fileName: 'a.gguf' },
      { type: 'cancelDownload' },
    );
    expect(state).toMatchObject({ phase: 'SelectingModel', selected: 'a.gguf', error: null });
  });

  it('answers that arrive after a cancel are ignored (race)', () => {
    const cancelled = run(
      selecting(),
      { type: 'startDownload', fileName: 'a.gguf' },
      { type: 'cancelDownload' },
    );
    expect(run(cancelled, { type: 'downloadFailed', attempt: 2, message: 'late' })).toBe(cancelled);
    expect(run(cancelled, { type: 'downloadSaved', attempt: 2, fileName: 'a.gguf' })).toBe(
      cancelled,
    );
    expect(run(cancelled, { type: 'progress', fileName: 'a.gguf', percent: 80 })).toBe(cancelled);
  });

  it('a cancelled answer for an older attempt does not touch a newer download', () => {
    const second = run(
      selecting(),
      { type: 'startDownload', fileName: 'a.gguf' },
      { type: 'cancelDownload' },
      { type: 'startDownload', fileName: 'a.gguf' },
    );
    expect(second).toMatchObject({ phase: 'Downloading', attempt: 4 });
    expect(run(second, { type: 'downloadCancelled', attempt: 2 })).toBe(second);
    expect(run(second, { type: 'downloadCancelled', attempt: 4 }).phase).toBe('SelectingModel');
  });

  it('answers after the dialog was closed are ignored', () => {
    const closed = run(
      selecting(),
      { type: 'startDownload', fileName: 'a.gguf' },
      { type: 'close' },
    );
    expect(closed.phase).toBe('Closed');
    expect(run(closed, { type: 'downloadSaved', attempt: 2, fileName: 'a.gguf' })).toBe(closed);
    expect(run(closed, loaded(1))).toBe(closed);
  });

  it('a saved download completes with the Local result (item 133)', () => {
    const state = run(
      selecting(),
      { type: 'startDownload', fileName: 'a.gguf' },
      { type: 'downloadSaved', attempt: 2, fileName: 'a.gguf' },
    );
    expect(state).toMatchObject({
      phase: 'Completed',
      result: { kind: 'Local', fileName: 'a.gguf' },
    });
  });

  it('choosing an already downloaded file completes after the save answer (item 131)', () => {
    const saving = run(selecting(), { type: 'startSave', fileName: 'b.gguf' });
    expect(saving).toMatchObject({ phase: 'SelectingModel', busy: true });
    const done = run(saving, {
      type: 'downloadSaved',
      attempt: saving.attempt,
      fileName: 'b.gguf',
    });
    expect(done).toMatchObject({
      phase: 'Completed',
      result: { kind: 'Local', fileName: 'b.gguf' },
    });
  });

  it('a save that fails leaves the list with the error and lets the user try again', () => {
    const saving = run(selecting(), { type: 'startSave', fileName: 'b.gguf' });
    const failed = run(saving, {
      type: 'downloadFailed',
      attempt: saving.attempt,
      message: 'disk',
    });
    expect(failed).toMatchObject({ phase: 'SelectingModel', busy: false, error: 'disk' });
  });

  it('a CLI that is ready completes with that kind', () => {
    const state = run(
      initialWizardState('choose'),
      { type: 'chooseEngine', engine: 'Codex' },
      { type: 'cliReady' },
    );
    expect(state).toMatchObject({ phase: 'Completed', result: { kind: 'Codex' } });
  });

  it('close ends the wizard from any phase', () => {
    for (const start of [
      initialWizardState('choose'),
      initialWizardState('local-only'),
      selecting(),
    ]) {
      expect(run(start, { type: 'close' }).phase).toBe('Closed');
    }
  });

  it('actions that do not fit the phase change nothing', () => {
    const chooser = initialWizardState('choose');
    expect(run(chooser, { type: 'select', fileName: 'a.gguf' })).toBe(chooser);
    expect(run(chooser, { type: 'cancelDownload' })).toBe(chooser);
    expect(run(chooser, { type: 'cliReady' })).toBe(chooser);
  });
});
