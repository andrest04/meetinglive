import { describe, expect, it } from 'vitest';
import { isTrustedIpcSender, isTrustedUrl, type IpcEventLike } from './trusted-origin';

const dev = { devServerOrigin: 'http://localhost:5173' };

describe('isTrustedUrl', () => {
  it('trusts the app scheme and host', () => {
    expect(isTrustedUrl('vozella://app/index.html')).toBe(true);
    expect(isTrustedUrl('vozella://app/assets/x.js?a=1#b')).toBe(true);
  });

  it.each([
    'vozella://evil/index.html',
    'https://app/',
    'https://example.com',
    'file:///C:/index.html',
    'javascript:alert(1)',
    'data:text/html,hi',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isTrustedUrl(url, dev)).toBe(false);
  });

  it('trusts the dev server only when configured', () => {
    expect(isTrustedUrl('http://localhost:5173/')).toBe(false);
    expect(isTrustedUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true);
    expect(isTrustedUrl('http://localhost:5174/', dev)).toBe(false);
    expect(isTrustedUrl('http://localhost:5173.evil.com/', dev)).toBe(false);
  });
});

describe('isTrustedIpcSender', () => {
  const ids = new Set([7]);
  const event = (over: Partial<IpcEventLike> = {}): IpcEventLike => ({
    sender: { id: 7 },
    senderFrame: { url: 'vozella://app/index.html', parent: null },
    ...over,
  });

  it('accepts the top frame of a known window showing app content', () => {
    expect(isTrustedIpcSender(event(), ids)).toBe(true);
  });

  it('rejects unknown web contents', () => {
    expect(isTrustedIpcSender(event({ sender: { id: 8 } }), ids)).toBe(false);
  });

  it('rejects sub frames', () => {
    const sub = { url: 'vozella://app/index.html', parent: {} };
    expect(isTrustedIpcSender(event({ senderFrame: sub }), ids)).toBe(false);
  });

  it('rejects a missing frame (destroyed or navigated away)', () => {
    expect(isTrustedIpcSender(event({ senderFrame: null }), ids)).toBe(false);
    expect(isTrustedIpcSender(event({ senderFrame: undefined }), ids)).toBe(false);
  });

  it('rejects a trusted window that navigated to foreign content', () => {
    const foreign = { url: 'https://example.com/', parent: null };
    expect(isTrustedIpcSender(event({ senderFrame: foreign }), ids)).toBe(false);
  });
});
