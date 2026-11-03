import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFlagFileScanner, fakeCallFlagPath } from './fake-call-scanner';

describe('fake call scanner', () => {
  it('reports a call while the flag file exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-flag-'));
    const flag = path.join(dir, 'call.flag');
    const scanner = createFlagFileScanner(flag);
    expect(await scanner.anyMeetingWindow()).toBe(false);
    fs.writeFileSync(flag, '');
    expect(await scanner.anyMeetingWindow()).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(await scanner.anyMeetingWindow()).toBe(false);
  });

  it('is only honored in test mode', () => {
    const env = { VOZELLA_FAKE_CALL_FLAG: 'x' };
    expect(fakeCallFlagPath(env, true)).toBe('x');
    expect(fakeCallFlagPath(env, false)).toBeUndefined();
    expect(fakeCallFlagPath({}, true)).toBeUndefined();
  });
});
