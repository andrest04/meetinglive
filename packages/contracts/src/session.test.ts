import { describe, expect, it } from 'vitest';
import { requestChannels, sessionGetView, sessionRename, sessionRevealFile } from './index';

describe('session contracts', () => {
  it('registers every session request by name', () => {
    for (const c of [sessionGetView, sessionRename, sessionRevealFile]) {
      expect(requestChannels[c.name as keyof typeof requestChannels]).toBe(c);
    }
    expect(sessionGetView.name).toBe('session.getView');
  });

  it('accepts a missing meeting as an empty view', () => {
    const out = sessionGetView.output.safeParse({
      record: null,
      hasTranscript: false,
      hasAudio: false,
    });
    expect(out.success).toBe(true);
  });

  it('rejects a blank id and an unknown rename status', () => {
    expect(sessionRevealFile.input.safeParse({ id: '' }).success).toBe(false);
    expect(sessionRename.output.safeParse({ status: 'oops' }).success).toBe(false);
    expect(sessionRename.output.safeParse({ status: 'blocked' }).success).toBe(true);
    expect(sessionRename.input.safeParse({ id: 'a', title: 'x' }).success).toBe(true);
  });
});
