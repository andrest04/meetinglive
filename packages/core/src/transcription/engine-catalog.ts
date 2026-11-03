import type { AsrBackend } from './asr-types';

/**
 * The pinned downloads of the transcription engine (spec 3.9). "Latest" for the user means these
 * exact files again, not a floating build. The runtime is NeMo-Speech.cpp v0.3.0; the GGUF files
 * are pinned to a commit and carry a SHA-256 that is checked after the download (B5).
 */

export interface PinnedFile {
  readonly fileName: string;
  readonly displayName: string;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
}

export const NEMOTRON_MODEL: PinnedFile = {
  fileName: 'nemotron-3.5-asr-streaming-0.6b.q8_0.gguf',
  displayName: 'Nemotron 3.5 ASR Streaming 0.6B',
  url: 'https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/ea30d66debe3740a08b573244286791d423d6b3e/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf',
  sha256: '3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1',
  bytes: 742_090_464,
};

export const SORTFORMER_MODEL: PinnedFile = {
  fileName: 'diar_streaming_sortformer_4spk-v2.q8_0.gguf',
  displayName: 'Sortformer 4-speaker v2',
  url: 'https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2/resolve/5240a64075176943f677d30fa2171c780229f341/diar_streaming_sortformer_4spk-v2.q8_0.gguf',
  sha256: '0679cfeb1ce356d0dea9470b31274f4bfc7eb927497d82005483770666da998a',
  bytes: 0,
};

export const NEMO_RUNTIME_VERSION = 'v0.3.0';
export const NEMO_RUNTIME_DLL = 'nemo_speech_asr_c.dll';

export interface PinnedRuntime {
  readonly backend: AsrBackend;
  /** Folder name under the NemoSpeech directory. */
  readonly folder: string;
  readonly url: string;
  readonly sha256: string;
}

const releaseBase = `https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/${NEMO_RUNTIME_VERSION}`;

export const NEMO_RUNTIMES: Readonly<Record<AsrBackend, PinnedRuntime>> = {
  cpu: {
    backend: 'cpu',
    folder: 'cpu',
    url: `${releaseBase}/nemo-speech-0.3.0-windows-x86_64-cpu.zip`,
    sha256: '4ed9740e361e4653f56c3dce7d1e81883a1c8b831c1bd7d01567fff1130b5b05',
  },
  cuda: {
    backend: 'cuda',
    folder: 'cuda',
    url: `${releaseBase}/nemo-speech-0.3.0-windows-x86_64-cuda.zip`,
    sha256: 'd0d32ae1bf6ee0534767a47b2aa0e9e2ff6fe39643465c0baae9301d04f6ed42',
  },
};
