import type {
  AsrEngine,
  AsrRecognizer,
  AsrResult,
  AsrStream,
  RecognizerSettings,
  StreamOptions,
} from '@vozella/core';

const PHRASES: readonly string[] = [
  'Buenos días a todos y gracias por venir.',
  'Hoy revisamos el presupuesto del trimestre.',
  'Quedamos en cerrar las fechas de entrega esta semana.',
];

/** A direct question for the live question detection e2e. */
export const FAKE_QUESTION_PHRASE = '¿Cuál es el tercer principio del manifiesto ágil?';

/**
 * The script the fake engine reads. `VOZELLA_FAKE_ASR_QUESTION=1` puts the question second
 * (3 to 6 s of audio); without it the script is the three statements every other test expects.
 */
export function fakeAsrPhrasesFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  if (env.VOZELLA_FAKE_ASR_QUESTION !== '1') return PHRASES;
  const [first = '', ...rest] = PHRASES;
  return [first, FAKE_QUESTION_PHRASE, ...rest];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A speech engine that "hears" a fixed script, for the fake native build. No model, no GPU. */
export class FakeSpeechEngine implements AsrEngine {
  /**
   * `offlinePushMs` slows the offline pass only, so a test can cancel it while it runs. The live
   * preview is never slowed.
   */
  constructor(
    private readonly offlinePushMs = 0,
    private readonly phrases: readonly string[] = PHRASES,
  ) {}

  createRecognizer(settings: RecognizerSettings): Promise<AsrRecognizer> {
    const delay = settings.latency === 'offline' ? this.offlinePushMs : 0;
    return Promise.resolve({
      startStream: (options: StreamOptions) =>
        Promise.resolve(new FakeSpeechStream(options, delay, this.phrases)),
      dispose: () => Promise.resolve(),
    });
  }
}

/** Every 3 s of audio ends a phrase (a final); in between the phrase grows word by word. */
class FakeSpeechStream implements AsrStream {
  private audioMs = 0;
  private emittedPhrases = 0;
  private pending: AsrResult[] = [];

  constructor(
    private readonly options: StreamOptions,
    private readonly pushDelayMs: number,
    private readonly phrases: readonly string[],
  ) {}

  async push(samples: Float32Array, sampleRate: number): Promise<void> {
    if (this.pushDelayMs > 0) await sleep(this.pushDelayMs);
    this.audioMs += (samples.length * 1000) / sampleRate;
    const completed = Math.floor(this.audioMs / 3000);
    while (this.emittedPhrases < completed) {
      const index = this.emittedPhrases;
      const phrase = this.phrases[index % this.phrases.length] ?? '';
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
      const next = (this.phrases[this.emittedPhrases % this.phrases.length] ?? '').split(' ');
      const into = Math.max(1, Math.floor(((this.audioMs % 3000) / 3000) * next.length));
      this.pending.push({
        isFinal: false,
        transcript: next.slice(0, into).join(' '),
        audioProcessedSeconds: this.audioMs / 1000,
        words: [],
      });
    }
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
