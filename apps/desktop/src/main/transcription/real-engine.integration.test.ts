/**
 * Real-engine proof of the transcription module. It loads NeMo-Speech.cpp v0.3.0 and the
 * Nemotron model through koffi, with the production stores, host, worker and services, and
 * transcribes a Spanish WAV made by the Windows speech synthesizer (SAPI). No account, no user
 * data, no network except the optional Sortformer download from the public model host.
 *
 *   VOZELLA_REAL_ASR=1 pnpm --filter @vozella/desktop exec vitest run real-engine
 *
 * Files come from `VOZELLA_ASR_DL` (default C:\Code\vozella-spikes\asr\dl): `models\nemotron.q8_0.gguf`,
 * `rt-cpu`, `rt-cuda`. Set `VOZELLA_REAL_ASR_NET=1` to also download the Sortformer model and try
 * speaker labels. Results are written to the test output so the parity ledger can quote them.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { NEMOTRON_MODEL, RuntimeInUseError, SORTFORMER_MODEL, type Logger } from '@vozella/core';
import {
  downloadToFile,
  NemoSpeechRuntimeManager,
  TranscriptionRuntime,
  WavFrameReader,
} from '@vozella/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadNemoLibrary, structSizes, type Koffi } from '../../workers/asr/nemo-library';
import { AsrWorkerHost } from '../workers/asr-worker-host';
import { inProcessAsrWorker } from '../workers/in-process-asr-worker';

const enabled = process.env.VOZELLA_REAL_ASR === '1' && process.platform === 'win32';
const withNet = process.env.VOZELLA_REAL_ASR_NET === '1';
const dl = process.env.VOZELLA_ASR_DL ?? 'C:\\Code\\vozella-spikes\\asr\\dl';
const say = (line: string): void => {
  process.stdout.write(`[real-asr] ${line}\n`);
};

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (m, c) => {
    say(`warn ${m} ${JSON.stringify(c ?? {})}`);
  },
  error: (m, c) => {
    say(`error ${m} ${JSON.stringify(c ?? {})}`);
  },
};

const SENTENCE =
  'Buenos días a todos. Hoy vamos a revisar el presupuesto del tercer trimestre y acordar las fechas de entrega del proyecto. Por favor, Ana, comparte los resultados de ventas de este mes.';

/** Speaks `text` with the first installed Spanish voice (or the named one) as 16 kHz mono PCM16. */
function speak(file: string, text: string, voiceName?: string): string {
  const script = `
param([string]$Out, [string]$Text, [string]$Voice)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Voice) { $s.SelectVoice($Voice) } else {
  $es = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'es-*' } | Select-Object -First 1
  if ($es) { $s.SelectVoice($es.VoiceInfo.Name) }
}
$name = $s.Voice.Name
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($Out, $fmt)
$s.Speak($Text)
$s.Dispose()
Write-Output $name
`;
  const scriptFile = `${file}.ps1`;
  fs.writeFileSync(scriptFile, script);
  const run = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptFile,
      '-Out',
      file,
      '-Text',
      text,
      '-Voice',
      voiceName ?? '',
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`SAPI failed: ${run.stderr}`);
  return run.stdout.trim();
}

describe.skipIf(!enabled)('real engine (NeMo-Speech.cpp v0.3.0 through koffi)', () => {
  let work = '';
  let koffi: Koffi;
  let wav = '';
  let voice = '';
  let hosts: AsrWorkerHost[] = [];
  const junctions: string[] = [];

  /** A runtime wired like the app, over a private data root that links the downloaded files. */
  function build(gpuName: string | null) {
    const root = path.join(work, `root-${String(hosts.length)}`);
    const models = path.join(root, 'TranscriptionModels');
    const engine = path.join(root, 'NemoSpeech');
    fs.mkdirSync(models, { recursive: true });
    fs.mkdirSync(engine, { recursive: true });
    const modelFile = path.join(models, NEMOTRON_MODEL.fileName);
    try {
      fs.linkSync(path.join(dl, 'models', 'nemotron.q8_0.gguf'), modelFile);
    } catch {
      fs.copyFileSync(path.join(dl, 'models', 'nemotron.q8_0.gguf'), modelFile);
    }
    fs.cpSync(
      path.join(dl, 'rt-cpu', 'nemo-speech-0.3.0-windows-x86_64-cpu'),
      path.join(engine, 'cpu', 'nemo-speech-0.3.0-windows-x86_64-cpu'),
      { recursive: true },
    );
    fs.symlinkSync(path.join(dl, 'rt-cuda'), path.join(engine, 'cuda'), 'junction');
    junctions.push(path.join(engine, 'cuda'));
    const host = new AsrWorkerHost({
      logger,
      spawn: () => inProcessAsrWorker((dir) => loadNemoLibrary(koffi, dir)),
      requestTimeoutMs: 300_000,
    });
    hosts.push(host);
    const runtime = new TranscriptionRuntime({
      transcriptionModelsDirectory: models,
      nemoSpeechDirectory: engine,
      engine: host,
      hardware: () => Promise.resolve({ gpuName }),
      logger,
    });
    return { runtime, host, models, engine };
  }

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-real-asr-'));
    koffi = createRequire(import.meta.url)('koffi') as Koffi;
    wav = path.join(work, 'es.wav');
    voice = speak(wav, SENTENCE);
    say(`SAPI voice: ${voice}; wav ${String(fs.statSync(wav).size)} bytes`);
  });

  afterAll(async () => {
    for (const host of hosts) await host.dispose();
    hosts = [];
    // Remove the links first, so cleaning up can never reach the downloaded files they point to.
    for (const junction of junctions) fs.rmdirSync(junction);
    try {
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // The loaded DLLs stay locked until this process ends; the OS temp folder is cleaned later.
    }
  });

  it('the struct sizes match the v0.3.0 header on this ABI', () => {
    expect(structSizes(koffi)).toEqual({
      backend: 16,
      model: 24,
      streaming: 24,
      endpointing: 16,
      diar: 40,
      recognizer: 88,
      options: 72,
    });
  });

  it('transcribes the Spanish WAV offline on CUDA when the GPU is there, and reports the backend', async () => {
    const { runtime } = build('NVIDIA GeForce RTX 3070 Laptop GPU');
    expect(runtime.installer.isReady()).toBe(true);
    const progress: number[] = [];
    const started = Date.now();
    const text = await runtime.offline.transcribe({
      audioPath: wav,
      language: 'es',
      recordedAtMs: Date.UTC(2026, 10, 2, 14, 5),
      speakerDiarization: false,
      onProgress: (p) => progress.push(p),
    });
    say(`offline ${runtime.status.current?.backend ?? '?'} in ${String(Date.now() - started)} ms`);
    say(`offline text:\n${text}`);
    expect(runtime.status.current?.backend).toBe('cuda');
    expect(runtime.status.current?.fallbackReason).toBeNull();
    expect(text).toMatch(/^Recorded 2026-11-0\d/);
    expect(text.toLowerCase()).toContain('presupuesto');
    expect(text.toLowerCase()).toContain('trimestre');
    expect(text).toMatch(/\[\d\d:\d\d\.\d\d-\d\d:\d\d\.\d\d\] /);
    expect(progress.at(-1)).toBe(100);
    expect(new Set(progress).size).toBe(progress.length);
  }, 300_000);

  it('then loads the CPU runtime in the same process and gets the same words', async () => {
    const { runtime } = build(null);
    const started = Date.now();
    const text = await runtime.offline.transcribe({
      audioPath: wav,
      language: 'es',
      recordedAtMs: null,
      speakerDiarization: false,
    });
    say(`offline cpu in ${String(Date.now() - started)} ms`);
    say(`offline cpu text:\n${text}`);
    expect(runtime.status.current).toMatchObject({ backend: 'cpu', fallbackReason: null });
    expect(text.toLowerCase()).toContain('presupuesto');
  }, 300_000);

  it('runs the live pass over real-time frames, with interim rewrites and a committed result', async () => {
    const { runtime } = build(null);
    const source = new WavFrameReader().open(wav);
    const updates: { displayText: string; committedText: string }[] = [];
    runtime.live.onTranscriptUpdated((u) => updates.push(u));
    await runtime.live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    const buffer = new Float32Array(1600);
    for (;;) {
      const n = source.read(buffer);
      if (n === 0) break;
      runtime.live.pushFrame(buffer.slice(0, n), source.sampleRate);
      await new Promise((r) => setTimeout(r, 100));
    }
    source.close();
    const committed = await runtime.live.stop();
    say(
      `live updates: ${String(updates.length)}; last display:\n${updates.at(-1)?.displayText ?? ''}`,
    );
    say(`live committed:\n${committed}`);
    const drops = runtime.status.lastLiveDrops;
    say(`live drops: ${JSON.stringify(drops)}`);
    expect(updates.length).toBeGreaterThan(0);
    expect(committed.toLowerCase()).toContain('presupuesto');
    expect(drops?.droppedMs).toBe(0);
  }, 120_000);

  it('installs the real v0.3.0 CPU zip: pinned checksum, tar extraction, promote', async () => {
    const root = path.join(work, 'install');
    const manager = new NemoSpeechRuntimeManager({
      root,
      download: (_url, target) => {
        fs.copyFileSync(path.join(dl, 'zips', 'cpu.zip'), target);
        return Promise.resolve();
      },
    });
    const started = Date.now();
    await manager.download('cpu', () => undefined);
    say(
      `cpu zip verified against the pin, extracted and promoted in ${String(Date.now() - started)} ms`,
    );
    expect(manager.isReady('cpu')).toBe(true);
    expect(fs.existsSync(path.join(manager.binDirectory('cpu'), 'nemo_speech_asr_c.dll'))).toBe(
      true,
    );
    expect(fs.readdirSync(root).sort()).toEqual(['cpu']);
  }, 120_000);

  it('refuses to delete the runtime while the library is loaded, and removes nothing', async () => {
    const { runtime } = build(null);
    await runtime.offline.transcribe({
      audioPath: wav,
      language: 'es',
      recordedAtMs: null,
      speakerDiarization: false,
    });
    await expect(runtime.runtimes.delete()).rejects.toBeInstanceOf(RuntimeInUseError);
    expect(runtime.runtimes.isReady('cpu')).toBe(true);
    expect(await runtime.installer.deleteEngine()).toBe('RuntimeInUse');
    expect(runtime.models.isModelDownloaded()).toBe(true);
  }, 120_000);

  describe.skipIf(!withNet)('speaker labels with Sortformer', () => {
    it('downloads the pinned model with its checksum and tries diarization on a two voice WAV', async () => {
      const cache = path.join(os.tmpdir(), 'vozella-asr-cache');
      const cached = path.join(cache, SORTFORMER_MODEL.fileName);
      if (!fs.existsSync(cached) || fs.statSync(cached).size < 100_000_000) {
        const percents: number[] = [];
        await downloadToFile({
          url: SORTFORMER_MODEL.url,
          target: cached,
          sha256: SORTFORMER_MODEL.sha256,
          resume: true,
          stallTimeoutMs: 60_000,
          onProgress: (p) => percents.push(p),
        });
        say(`sortformer downloaded, ${String(percents.length)} progress steps`);
      }
      const { runtime, models } = build(null);
      fs.linkSync(cached, path.join(models, SORTFORMER_MODEL.fileName));
      expect(runtime.models.isDiarizationModelDownloaded()).toBe(true);

      // Two different voices speaking in turn, joined into one WAV.
      const voices = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture.Name }',
        ],
        { encoding: 'utf8' },
      ).stdout.trim();
      say(`installed voices: ${voices.replace(/\r?\n/g, ', ')}`);
      const names = voices.split(/\r?\n/).map((v) => v.split('|')[0] ?? '');
      const second = names.find((n) => n !== voice && n !== '') ?? voice;
      const partA = path.join(work, 'a.wav');
      const partB = path.join(work, 'b.wav');
      speak(
        partA,
        'Buenos días, vamos a empezar la reunión de hoy con el informe de ventas.',
        voice,
      );
      speak(
        partB,
        'Gracias. Primero quiero hablar del presupuesto y de los plazos del proyecto.',
        second,
      );
      const join = (files: string[], out: string): void => {
        const pcm = files.flatMap((f) => {
          const b = fs.readFileSync(f);
          return [b.subarray(44 + (b.readUInt32LE(16) - 16))];
        });
        const gap = Buffer.alloc(32_000);
        const data = Buffer.concat([pcm[0] ?? gap, gap, pcm[1] ?? gap, gap, pcm[0] ?? gap]);
        const head = Buffer.alloc(44);
        head.write('RIFF', 0);
        head.writeUInt32LE(36 + data.length, 4);
        head.write('WAVEfmt ', 8);
        head.writeUInt32LE(16, 16);
        head.writeUInt16LE(1, 20);
        head.writeUInt16LE(1, 22);
        head.writeUInt32LE(16_000, 24);
        head.writeUInt32LE(32_000, 28);
        head.writeUInt16LE(2, 32);
        head.writeUInt16LE(16, 34);
        head.write('data', 36);
        head.writeUInt32LE(data.length, 40);
        fs.writeFileSync(out, Buffer.concat([head, data]));
      };
      const turns = path.join(work, 'turns.wav');
      join([partA, partB], turns);
      say(`two voices: ${voice} and ${second}`);

      const text = await runtime.offline.transcribe({
        audioPath: turns,
        language: 'es',
        recordedAtMs: null,
        speakerDiarization: true,
      });
      say(`diarized text:\n${text}`);
      say(`backend usage: ${JSON.stringify(runtime.status.current)}`);
      expect(runtime.status.current?.diarization).toBe('on');
      expect(text).toMatch(/\[ Speaker-\d \]/);

      // The same audio through the live pass, with the library's streaming geometry.
      const source = new WavFrameReader().open(turns);
      const buffer = new Float32Array(1600);
      await runtime.live.start({ language: 'es', recordedAtMs: null, speakerDiarization: true });
      for (;;) {
        const n = source.read(buffer);
        if (n === 0) break;
        runtime.live.pushFrame(buffer.slice(0, n), source.sampleRate);
        await new Promise((r) => setTimeout(r, 100));
      }
      source.close();
      const liveText = await runtime.live.stop();
      say(`live diarized text:\n${liveText}`);
      say(`live diarization drops: ${JSON.stringify(runtime.status.lastLiveDrops)}`);
    }, 600_000);
  });
});
