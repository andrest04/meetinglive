import { describe, expect, it } from 'vitest';
import { FAKE_QUESTION_PHRASE, FakeSpeechEngine, fakeAsrPhrasesFromEnv } from './fake-asr-engine';

async function finals(phrases?: readonly string[]): Promise<string[]> {
  const engine = phrases ? new FakeSpeechEngine(0, phrases) : new FakeSpeechEngine();
  const recognizer = await engine.createRecognizer({ latency: 'live' } as never);
  const stream = await recognizer.startStream({
    interimResults: false,
    diarization: false,
  } as never);
  // 9 s of 16 kHz audio: three finals.
  await stream.push(new Float32Array(16_000 * 9), 16_000);
  return (await stream.pullAvailable()).filter((r) => r.isFinal).map((r) => r.transcript);
}

describe('FakeSpeechEngine script', () => {
  it('reads the three statements by default', async () => {
    expect(await finals()).toEqual([
      'Buenos días a todos y gracias por venir.',
      'Hoy revisamos el presupuesto del trimestre.',
      'Quedamos en cerrar las fechas de entrega esta semana.',
    ]);
    expect(fakeAsrPhrasesFromEnv({})).toHaveLength(3);
  });

  it('puts the question second when VOZELLA_FAKE_ASR_QUESTION=1', async () => {
    const phrases = fakeAsrPhrasesFromEnv({ VOZELLA_FAKE_ASR_QUESTION: '1' });
    expect(phrases).toHaveLength(4);
    expect((await finals(phrases))[1]).toBe(FAKE_QUESTION_PHRASE);
  });
});
