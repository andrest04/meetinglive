import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('string catalogs on disk', () => {
  it('are exactly what scripts/convert-strings.mjs produces from the WinUI resources', () => {
    const script = path.resolve(__dirname, '../../../../scripts/convert-strings.mjs');
    expect(() =>
      execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});
