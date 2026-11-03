import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// The real speech engine in the real app: the ASR utility process loads NeMo-Speech.cpp v0.3.0
// through koffi and re-transcribes a Spanish WAV made by the Windows synthesizer. It needs the
// files the spikes downloaded and runs only on request:
//
//   VOZELLA_REAL_ASR=1 pnpm --filter @vozella/desktop exec playwright test transcription-real
//
// It uses a throwaway data root, the CPU runtime copied into it, no network and no account.

const dl = process.env.VOZELLA_ASR_DL ?? 'C:\\Code\\vozella-spikes\\asr\\dl';
const sampleWav = path.resolve(dl, '..', 'audio', 'es-sabina-16k.wav');
const MODEL_FILE = 'nemotron-3.5-asr-streaming-0.6b.q8_0.gguf';
const MEETING_ID = '4f0f3a52-2f1e-4f0e-9a52-0d2b8f6f2a11';

test.skip(process.env.VOZELLA_REAL_ASR !== '1', 'set VOZELLA_REAL_ASR=1 to run the real engine');

let launched: LaunchedApp;
let audioPath = '';

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_FAKE_NATIVE: '0' }, (dataRoot) => {
    const app = path.join(dataRoot, 'app');
    const models = path.join(app, 'TranscriptionModels');
    fs.mkdirSync(models, { recursive: true });
    const source = path.join(dl, 'models', 'nemotron.q8_0.gguf');
    try {
      fs.linkSync(source, path.join(models, MODEL_FILE));
    } catch {
      fs.copyFileSync(source, path.join(models, MODEL_FILE));
    }
    fs.cpSync(
      path.join(dl, 'rt-cpu', 'nemo-speech-0.3.0-windows-x86_64-cpu'),
      path.join(app, 'NemoSpeech', 'cpu', 'nemo-speech-0.3.0-windows-x86_64-cpu'),
      { recursive: true },
    );
    const inbox = path.join(dataRoot, 'meetings', 'Inbox');
    fs.mkdirSync(inbox, { recursive: true });
    audioPath = path.join(inbox, 'standup.wav');
    fs.copyFileSync(sampleWav, audioPath);
    fs.writeFileSync(
      path.join(inbox, '2026-11-02 Standup.md'),
      [
        '---',
        `id: ${MEETING_ID}`,
        'title: Standup',
        'recordedAt: 2026-11-02T14:05:00.0000000+00:00',
        `audioFilePath: ${audioPath}`,
        '---',
        '',
        '## Transcript',
        '',
        '[00:00.00-00:01.00] texto viejo',
        '',
        '## Summary',
        '',
        'Resumen que debe quedar igual.',
        '',
      ].join('\n'),
      'utf8',
    );
  });
});

test.afterAll(async () => {
  await launched.close();
});

test('re-transcribes a saved meeting through the ASR utility process', async () => {
  test.setTimeout(180_000);
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();

  const before = await page.evaluate(() => window.vozella.invoke('transcription.getStatus', {}));
  expect(before).toMatchObject({
    ready: true,
    modelInstalled: true,
    runtimes: { cpu: true, cuda: false },
    usage: null,
    language: 'es',
  });

  expect(
    await page.evaluate(
      (meetingId) => window.vozella.invoke('retranscription.availability', { meetingId }),
      MEETING_ID,
    ),
  ).toEqual({ availability: 'Available' });

  const started = await page.evaluate(
    (meetingId) => window.vozella.invoke('retranscription.start', { meetingId }),
    MEETING_ID,
  );
  expect(started).toEqual({ started: true, reason: null });

  await expect
    .poll(
      async () => {
        const meeting = await page.evaluate(
          (id) => window.vozella.invoke('library.getMeeting', { id }),
          MEETING_ID,
        );
        return JSON.stringify(meeting).includes('presupuesto');
      },
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe(true);

  const meeting = await page.evaluate(
    (id) => window.vozella.invoke('library.getMeeting', { id }),
    MEETING_ID,
  );
  const text = JSON.stringify(meeting);
  expect(text).toContain('Recorded 2026-11-02');
  expect(text).not.toContain('texto viejo');
  expect(text).toContain('Resumen que debe quedar igual.');

  // The engine ran in its own process, and the status now says which backend it used.
  const metrics = await launched.app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ type: m.type, name: m.name ?? '' })),
  );
  expect(metrics.some((m) => m.type === 'Utility' && m.name.includes('asr'))).toBe(true);
  const after = await page.evaluate(() => window.vozella.invoke('transcription.getStatus', {}));
  expect(after.usage).toMatchObject({ backend: 'cpu', fallbackReason: null });

  // The library is loaded in that process, so the runtime cannot be removed until a restart.
  const deletion = await page.evaluate(() =>
    window.vozella.invoke('transcription.deleteEngine', {}),
  );
  expect(deletion).toEqual({ outcome: 'RuntimeInUse' });
  expect(
    (await page.evaluate(() => window.vozella.invoke('transcription.getStatus', {}))).ready,
  ).toBe(true);
});
