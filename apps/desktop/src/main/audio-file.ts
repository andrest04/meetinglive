import fs from 'node:fs';

/** A recording counts as audio only when it exists and holds bytes (B20). */
export function hasAudioBytes(file: string): boolean {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}
