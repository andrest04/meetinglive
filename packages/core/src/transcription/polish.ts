import type { CancelSignal } from '../cancel';

/**
 * Transcript polish: prompt, chunking and output checks (spec 3.14). The four providers (local
 * model, Claude Code, Codex, xAI) are adapters and belong to the summary and local-inference
 * modules; they implement {@link TranscriptPolisher}.
 */
export interface TranscriptPolisher {
  polish(
    transcript: string,
    meetingLanguage: string | null,
    signal?: CancelSignal,
  ): Promise<string>;
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  es: 'Spanish',
  en: 'English',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  ja: 'Japanese',
  zh: 'Chinese',
};

/** Spanish when unset, as before. `auto` and unknown codes return null (B3). */
export function polishLanguageName(code: string | null): string | null {
  if (code === null || code.trim() === '') return 'Spanish';
  const wanted = code.trim().toLowerCase();
  return LANGUAGE_NAMES[wanted] ?? null;
}

const LANGUAGE_RULE_AUTO =
  '- Keep the spoken text in the language it was spoken in. Do not translate.';

/** The transcript cannot close the data block early (B16). */
const escapeTranscript = (text: string): string =>
  text.replace(/<\/transcript>/gi, '<\\/transcript>');

export function buildPolishPrompt(transcript: string, meetingLanguage: string | null): string {
  const name = polishLanguageName(meetingLanguage);
  const languageRule = name === null ? LANGUAGE_RULE_AUTO : `- Write the spoken text in ${name}.`;
  return `# Identity

You polish an automatic-speech-recognition transcript. You fix writing, not content.

# Instructions

Return ONLY the polished transcript. No preamble, no code fences, no commentary.

Rules:
- Keep the "Recorded ..." and "Ended ..." headers (if present) and every [start-end] prefix byte-for-byte.
- Keep existing "[ Speaker-N ]" labels when present. Do not add, drop, or rename speakers.
- Only edit the spoken text after the stamp and speaker label.
- Fix punctuation, Spanish/English accents, truecasing, and well-known acronyms (ONU, NASA, FBI, UNESCO).
- Convert obvious questions to ¿? / ?.
- Represent a clear pause as \`...\` only when the transcript already implies one.
- Do not add speakers, action items, or a summary.
- Do not drop lines.
- Do not invent content that was not spoken.
${languageRule}

# Transcript

<transcript>
${escapeTranscript(transcript)}
</transcript>`;
}

/** Packs whole lines into chunks of at most `maxChars` (joined with `\n`). */
export function splitTimestampedChunks(transcript: string, maxChars: number): string[] {
  if (maxChars <= 0) throw new RangeError('maxChars must be positive');
  if (transcript === '' || transcript.length <= maxChars) return [transcript];
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const line of transcript.split(/\r\n|\n/)) {
    const added = line.length + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && length + added > maxChars) {
      chunks.push(current.join('\n'));
      current = [];
      length = 0;
    }
    length += line.length + (current.length > 0 ? 1 : 0);
    current.push(line);
  }
  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}

/** Removes a code fence a model added despite the instruction (B16). */
export function stripCodeFences(output: string): string {
  const trimmed = output.trim();
  const match = /^```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
  return match ? (match[1] ?? '') : trimmed;
}

/** The polished text keeps every line and every stamp, or it is not used (B16). */
export function polishKeepsStructure(original: string, polished: string): boolean {
  const before = original.split(/\r\n|\n/).filter((l) => l.trim() !== '');
  const after = polished.split(/\r\n|\n/).filter((l) => l.trim() !== '');
  if (before.length !== after.length) return false;
  const stamp = /^(?:\* )?(\[\d+:\d{2}\.\d{2}-\d+:\d{2}\.\d{2}\])/;
  return before.every((line, i) => {
    const a = stamp.exec(line)?.[1];
    const b = stamp.exec(after[i] ?? '')?.[1];
    return a === b;
  });
}

/**
 * Polish never costs the transcript: any failure, or an answer that lost lines or stamps,
 * returns the raw transcript (B2, B16).
 */
export async function polishOrKeep(
  polisher: TranscriptPolisher,
  transcript: string,
  meetingLanguage: string | null,
  signal?: CancelSignal,
): Promise<string> {
  try {
    const polished = stripCodeFences(await polisher.polish(transcript, meetingLanguage, signal));
    return polished !== '' && polishKeepsStructure(transcript, polished) ? polished : transcript;
  } catch {
    return transcript;
  }
}
