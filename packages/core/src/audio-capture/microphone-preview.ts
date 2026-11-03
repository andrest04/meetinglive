import type { AudioCapturePort, CaptureSession } from '../device/audio-capture';
import { computeBufferRms } from './level-meter';

/**
 * The idle microphone level (spec 3.1.6): opens the mic, raises a 0..1 level per 20 ms
 * frame, writes and persists nothing. It never throws; a later start always works.
 */
export class MicrophoneLevelPreview {
  private session: CaptureSession | undefined;
  /** Bumped by every start and stop, so a start that finishes late can tell it lost. */
  private generation = 0;

  constructor(
    private readonly capture: AudioCapturePort,
    private readonly onLevel: (level: number) => void,
  ) {}

  async start(deviceId: string | null): Promise<void> {
    this.stop();
    const mine = this.generation;
    let session: CaptureSession;
    try {
      session = await this.capture.start(
        { kind: 'mic', deviceId },
        (frame) => {
          if (this.generation !== mine || frame.pcm.byteLength === 0) return;
          this.onLevel(computeBufferRms(frame.pcm, 'int16'));
        },
        () => {
          // The device went away mid preview.
          if (this.generation !== mine) return;
          this.release();
          this.onLevel(0);
        },
      );
    } catch {
      return;
    }
    if (this.generation !== mine) {
      // Another start or a stop overtook this one (S4): do not leave a capture running.
      stopQuietly(session);
      return;
    }
    this.session = session;
  }

  /** Idempotent, safe when not started. */
  stop(): void {
    this.generation += 1;
    this.release();
  }

  private release(): void {
    const session = this.session;
    this.session = undefined;
    if (session) stopQuietly(session);
  }
}

function stopQuietly(session: CaptureSession): void {
  try {
    session.stop();
  } catch {
    // Swallowed on purpose.
  }
}
