import type {
  AsrEngine,
  AsrRecognizer,
  AsrResult,
  AsrStream,
  RecognizerSettings,
  StreamOptions,
} from '@vozella/core';

const PHRASES = [
  'Buenos días a todos y gracias por venir.',
  'Hoy revisamos el presupuesto del trimestre.',
  'Quedamos en cerrar las fechas de entrega esta semana.',
];

/** A speech engine that "hears" a fixed script, for the fake native build. No model, no GPU. */
export class FakeSpeechEngine implements AsrEngine {
  createRecognizer(_settings: RecognizerSettings): Promise<AsrRecognizer> {
    return Promise.resolve({
      startStream: (options: StreamOptions) => Promise.resolve(new FakeSpeechStream(options)),
      dispose: () => Promise.resolve(),
    });
  }
}

/** Every 3 s of audio ends a phrase (a final); in between the phrase grows word by word. */
class FakeSpeechStream implements AsrStream {
  private audioMs = 0;
  private emittedPhrases = 0;
  private pending: AsrResult[] = [];

  constructor(private readonly options: StreamOptions) {}

  push(samples: Float32Array, sampleRate: number): Promise<void> {
    this.audioMs += (samples.length * 1000) / sampleRate;
    const completed = Math.floor(this.audioMs / 3000);
    while (this.emittedPhrases < completed) {
      const index = this.emittedPhrases;
      const phrase = PHRASES[index % PHRASES.length] ?? '';
      const words = phrase.split(' ');
      const start = index * 3000;
      const step = 2800 / words.length;
      this.pending.push({
        isFinal: true,
        transcript: phrase,
        audioProcessedSeconds: (start + 3000) / 1000,
        words: words.map((text, i) => ({
          text,
          startMs: Math.round(start + i * step),
          endMs: Math.round(start + (i + 1) * step),
          speakerTag: this.options.diarization ? (index % 2) + 1 : 0,
        })),
      });
      this.emittedPhrases += 1;
    }
    if (this.options.interimResults) {
      const next = (PHRASES[this.emittedPhrases % PHRASES.length] ?? '').split(' ');
      const into = Math.max(1, Math.floor(((this.audioMs % 3000) / 3000) * next.length));
      this.pending.push({
        isFinal: false,
        transcript: next.slice(0, into).join(' '),
        audioProcessedSeconds: this.audioMs / 1000,
        words: [],
      });
    }
    return Promise.resolve();
  }

  pullAvailable(): Promise<readonly AsrResult[]> {
    const out = this.pending;
    this.pending = [];
    return Promise.resolve(out);
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
