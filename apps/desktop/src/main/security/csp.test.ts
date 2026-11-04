import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

describe('buildCsp', () => {
  it('is strict in builds', () => {
    const csp = buildCsp({ dev: false });
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('ws:');
    expect(csp).toContain("object-src 'none'");
  });

  it('allows the dev server only in dev', () => {
    expect(buildCsp({ dev: true })).toContain('ws://localhost:*');
    expect(buildCsp({ dev: false })).not.toContain('localhost');
  });

  it('lets the app play its own audio and nothing else', () => {
    for (const dev of [false, true]) {
      expect(buildCsp({ dev })).toContain("media-src 'self';");
    }
  });

  it('never allows eval', () => {
    expect(buildCsp({ dev: true })).not.toContain('unsafe-eval');
  });
});
