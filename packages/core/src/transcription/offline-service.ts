import type { CancelSignal } from '../cancel';
import { engineLocaleFor } from '../settings/languages';
import { StreamingTranscriptAccumulator } from './accumulator';
import { MEETING_GEOMETRY } from './asr-types';
import { distinctPercent, toPercent } from './progress';
import { TranscriptionCancelledError, type AudioFrameReader } from './ports';
import type { NemoSpeechRecognizerFactory } from './recognizer-factory';

/** 100 ms of 16 kHz audio, per channel. */
export const OFFLINE_FRAME_SAMPLES = 1600;

export interface TranscribeRequest {
  readonly audioPath: string;
  readonly language: string | null;
  readonly recordedAtMs: number | null;
  readonly speakerDiarization: boolean;
  /** Whole percent of the audio; each value is reported once. */
  readonly onProgress?: (percent: number) => void;
  readonly cancel?: CancelSignal;
}

export interface TranscriptionServiceDeps {
  readonly factory: NemoSpeechRecognizerFactory;
  readonly audio: AudioFrameReader;
}

/** The offline pass over a finished WAV, for Stop, import and re-transcription (spec 3.11). */
export class TranscriptionService {
  constructor(private readonly deps: TranscriptionServiceDeps) {}

  async transcribe(request: TranscribeRequest): Promise<string> {
    const { cancel } = request;
    if (cancel?.cancelled) throw new TranscriptionCancelledError();

    const created = await this.deps.factory.create({
      enableDiarization: request.speakerDiarization,
      geometry: MEETING_GEOMETRY,
      latency: 'offline',
    });
    let stream: Awaited<ReturnType<typeof created.recognizer.startStream>> | null = null;
    let source: ReturnType<AudioFrameReader['open']> | null = null;
    try {
      stream = await created.recognizer.startStream({
        language: engineLocaleFor(request.language),
        interimResults: true,
        diarization: created.diarization,
      });
      const accumulator = new StreamingTranscriptAccumulator(request.recordedAtMs);
      source = this.deps.audio.open(request.audioPath);
      const report = distinctPercent((percent) => request.onProgress?.(percent));
      const channels = Math.max(1, source.channels);
      const buffer = new Float32Array(OFFLINE_FRAME_SAMPLES * channels);
      let readSamples = 0;

      for (;;) {
        if (cancel?.cancelled) throw new TranscriptionCancelledError();
        const count = source.read(buffer);
        if (count <= 0) break;
        readSamples += count;
        const mono = toMono(buffer, count, channels);
        if (mono.length > 0) {
          await stream.push(mono, source.sampleRate);
          for (const result of await stream.pullAvailable()) accumulator.apply(result);
        }
        const positionMs = (readSamples / channels / source.sampleRate) * 1000;
        report(toPercent(positionMs, source.durationMs));
      }
      accumulator.commitRemainingInterim();
      report(100);
      return accumulator.committedText;
    } finally {
      source?.close();
      try {
        await stream?.dispose();
      } finally {
        await created.recognizer.dispose();
      }
    }
  }
}

/** Averages the channels of each frame. A trailing partial frame is used as it is. */
export function toMono(interleaved: Float32Array, count: number, channels: number): Float32Array {
  const frames = Math.floor(count / channels);
  if (channels === 1) return interleaved.slice(0, frames);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += interleaved[i * channels + c] ?? 0;
    mono[i] = sum / channels;
  }
  return mono;
}
