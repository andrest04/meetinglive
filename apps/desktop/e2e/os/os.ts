import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Real composed screen pixels and real mouse input, through os.ps1 (copied from the window spike).
// Coordinates are physical pixels. Windows only.

const script = path.join(__dirname, 'os.ps1');

export function os(...args: (string | number)[]): string {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args.map(String)],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** "r,g,b;r,g,b" to numbers. */
export function rgb(text: string): number[][] {
  return text.split(';').map((part) => part.split(',').map(Number));
}

/** The colour of each physical screen pixel, in order. */
export function pixels(points: readonly { x: number; y: number }[]): number[][] {
  return rgb(os('px', ...points.flatMap((p) => [Math.round(p.x), Math.round(p.y)])));
}
