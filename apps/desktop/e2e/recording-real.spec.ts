import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// R12, the one real run: the real native addon, the real speech engine and the real Record page.
// A generated WAV (a tone, then a Spanish speech sample made by the Windows synthesizer) is played
// by a separate PowerShell process through the default output. The app captures only that process
// with process loopback, the live pass and the offline pass hear it with NeMo-Speech Nemotron on
// the CPU, and the summary comes from a fake `claude` executable on PATH that answers a fixed
// reply and records the prompt it got. No real CLI, account or network is used.
//
// It makes sound for about twenty seconds and needs the spike downloads, so it runs on request:
//
//   VOZELLA_REAL_ASR=1 VOZELLA_REAL_AUDIO=1 pnpm --filter @vozella/desktop exec playwright test recording-real
//
// Needs: a Windows build with process loopback (20348 or newer), a default output device, the
// model and CPU runtime under VOZELLA_ASR_DL (default C:\Code\vozella-spikes\asr\dl) and the speech
// sample under <dl>\..\audio. Without them the spec skips; the ledger marks the row
// pending-real-validation in that case.

const dl = process.env.VOZELLA_ASR_DL ?? 'C:\\Code\\vozella-spikes\\asr\\dl';
const sampleWav = path.resolve(dl, '..', 'audio', 'es-sabina-16k.wav');
const MODEL_FILE = 'nemotron-3.5-asr-streaming-0.6b.q8_0.gguf';
const REPLY = [
  '## Title',
  'Presupuesto del trimestre',
  '',
  '## Summary',
  '### Overview',
  'The team reviewed the quarter budget.',
  '',
  '## Action items',
  '- [ ] Send the budget to finance',
].join('\n');

const wanted = process.env.VOZELLA_REAL_ASR === '1' && process.env.VOZELLA_REAL_AUDIO === '1';
const present = fs.existsSync(path.join(dl, 'models', 'nemotron.q8_0.gguf')) && fs.existsSync(sampleWav);
test.skip(!wanted, 'set VOZELLA_REAL_ASR=1 and VOZELLA_REAL_AUDIO=1 to run the real recording');
test.skip(wanted && !present, `the model or speech sample is missing under ${dl}`);

let launched: LaunchedApp;
let page: Page;
let promptFile = '';
let player: ChildProcess | null = null;
let tempDir = '';

/** 16 kHz mono PCM16: 1.5 s of a 440 Hz tone, then the speech sample's samples. */
function buildWav(target: string): void {
  const sample = fs.readFileSync(sampleWav);
  let at = 12;
  let speech = Buffer.alloc(0);
  while (at + 8 <= sample.length) {
    const id = sample.subarray(at, at + 4).toString('ascii');
    const size = sample.readUInt32LE(at + 4);
    if (id === 'data') {
      speech = sample.subarray(at + 8, at + 8 + size);
      break;
    }
    at += 8 + size + (size % 2);
  }
  expect(speech.length).toBeGreaterThan(32_000);
  const toneSamples = 24_000;
  const tone = Buffer.alloc(toneSamples * 2);
  for (let i = 0; i < toneSamples; i += 1) {
    tone.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 16_000) * 0.3 * 32767), i * 2);
  }
  const data = Buffer.concat([tone, speech]);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(target, Buffer.concat([header, data]));
}

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-real-recording-'));
  const bin = path.join(tempDir, 'bin');
  fs.mkdirSync(bin);
  promptFile = path.join(tempDir, 'prompt.txt');
  const script = path.join(tempDir, 'fake-claude.cjs');
  fs.writeFileSync(
    script,
    [
      "const fs = require('node:fs');",
      'const chunks = [];',
      "process.stdin.on('data', (c) => chunks.push(c));",
      "process.stdin.on('end', () => {",
      `  fs.appendFileSync(${JSON.stringify(promptFile)}, Buffer.concat(chunks).toString('utf8') + '\\n=====\\n');`,
      `  process.stdout.write(${JSON.stringify(REPLY)});`,
      '});',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(bin, 'claude.cmd'),
    `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
  );
  launched = await launchApp(
    {
      VOZELLA_FAKE_NATIVE: '0',
      PATH: `${bin};${process.env.PATH ?? ''}`,
    },
    (dataRoot) => {
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
      fs.writeFileSync(
        path.join(app, 'settings.json'),
        JSON.stringify({ selectedSummaryProvider: 'ClaudeCode' }),
      );
    },
  );
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test.afterAll(async () => {
  if (player?.pid) {
    spawnSync('taskkill', ['/PID', String(player.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  await page?.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched?.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('a played WAV is captured by process loopback, heard by Nemotron and saved with a summary', async () => {
  test.setTimeout(300_000);
  const wav = path.join(tempDir, 'meeting-audio.wav');
  buildWav(wav);
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByTestId('BtnRecord')).toBeEnabled({ timeout: 60_000 });

  // A looping player so the app is listed while the take starts; the take hears the first pass.
  player = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$p = New-Object System.Media.SoundPlayer "${wav}"; Start-Sleep -Seconds 4; $p.PlaySync(); Start-Sleep -Seconds 60`,
    ],
    { stdio: 'ignore' },
  );
  const pid = player.pid ?? 0;
  expect(pid).toBeGreaterThan(0);

  // The player is an audio app once it plays; the sources panel lists it.
  const radio = page.getByRole('radio', { name: /PowerShell/i }).first();
  await expect(radio).toBeVisible({ timeout: 60_000 });

  await page.getByRole('textbox', { name: 'Title' }).fill('Real run');
  await radio.click();
  await page.getByTestId('BtnRecord').click();
  await expect(page.getByTestId('recording-bar')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('bar-sources')).toContainText(/PowerShell/i);

  // The live pass hears the Spanish sample while it plays.
  await expect(page.getByTestId('canvas-lines')).toContainText(/presupuesto|reuni|equipo|semana/i, {
    timeout: 90_000,
  });

  // Let the whole sample play (about 13 s after the tone), then stop.
  await page.waitForTimeout(20_000);
  await page.getByTestId('BtnStop').click();
  await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('status-text')).not.toContainText('Generating', {
    timeout: 120_000,
  });

  const saved = await (async () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) found.push(full);
      }
    };
    walk(launched.dataRoot);
    return found.map((f) => fs.readFileSync(f, 'utf8')).find((t) => t.includes('Real run')) ?? '';
  })();
  expect(saved).not.toBe('');
  expect(saved).toMatch(/Recorded/);
  expect(saved.toLowerCase()).toContain('presupuesto');
  expect(saved).toContain('The team reviewed the quarter budget.');
  expect(saved).toContain('Send the budget to finance');

  // The fake claude got a prompt that holds what the engine heard.
  const prompts = fs.readFileSync(promptFile, 'utf8').toLowerCase();
  expect(prompts).toContain('presupuesto');
});
