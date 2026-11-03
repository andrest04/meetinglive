/** Shared stamp format of the live preview and the offline pass (spec 3.7). */

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** `yyyy-MM-dd HH:mm` in the machine's local time. */
function localStamp(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export const formatHeader = (recordedAtMs: number): string =>
  `Recorded ${localStamp(recordedAtMs)}`;
export const formatEnded = (endedAtMs: number): string => `Ended ${localStamp(endedAtMs)}`;

/** `mm:ss.ff` with total minutes (125:03.20 is valid), hundredths truncated, negative as zero. */
export function formatElapsed(ms: number): string {
  const t = Math.max(0, Math.trunc(ms));
  const minutes = Math.floor(t / 60_000);
  const seconds = Math.floor((t % 60_000) / 1000);
  const hundredths = Math.floor((t % 1000) / 10);
  return `${pad2(minutes)}:${pad2(seconds)}.${pad2(hundredths)}`;
}

/** `[a-b] text`, or `[a-b] [ Speaker-N ] text` when the tag is above zero. */
export function formatLine(startMs: number, endMs: number, text: string, speakerTag = 0): string {
  const start = Math.max(0, startMs);
  const end = Math.max(endMs, start);
  const range = `[${formatElapsed(start)}-${formatElapsed(end)}]`;
  return speakerTag > 0 ? `${range} [ Speaker-${String(speakerTag)} ] ${text}` : `${range} ${text}`;
}

/**
 * Makes sure line 1 is an `Ended` header after the `Recorded` one. No change for an empty
 * transcript or an unknown time. Idempotent. A transcript that starts with `Ended` and has no
 * `Recorded` line gets a Recorded line in front of it instead of a second pair (B20).
 */
export function ensureEndedHeader(
  transcript: string,
  recordedAtMs: number | null,
  endedAtMs: number | null,
): string {
  if (transcript === '' || recordedAtMs === null || endedAtMs === null) return transcript;
  const newline = transcript.includes('\r\n') ? '\r\n' : '\n';
  const recorded = formatHeader(recordedAtMs);
  const ended = formatEnded(endedAtMs);
  const lines = transcript.split(/\r\n|\n/);
  const first = lines[0] ?? '';

  if (first.startsWith('Recorded ')) {
    if ((lines[1] ?? '').startsWith('Ended ')) {
      lines[1] = ended;
      return lines.join(newline);
    }
    return [first, ended, ...lines.slice(1)].join(newline);
  }
  if (first.startsWith('Ended ')) {
    return [recorded, ended, ...lines.slice(1)].join(newline);
  }
  return recorded + newline + ended + newline + transcript;
}
