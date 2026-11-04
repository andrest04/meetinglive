const blank = (text: string | null | undefined): boolean =>
  text === null || text === undefined || text.trim() === '';

/**
 * Whether the pipeline saves the meeting before it transcribes (spec 3.8). A draft always does.
 * Without a draft it does unless the meeting already points at this audio: a new take always
 * saves first, so a failed offline pass cannot orphan its audio, and a re-run over the same
 * audio leaves the previous transcript untouched until the new one succeeds.
 */
export function shouldSaveBeforeTranscribing(
  liveDraft: string | null,
  existingAudioPath: string | null,
  audioPath: string,
): boolean {
  if (!blank(liveDraft)) return true;
  return !sameAudioPath(existingAudioPath, audioPath);
}

/** Ordinal, case-insensitive comparison, as the Windows file system sees it. */
export function sameAudioPath(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

export const isBlankText = blank;
