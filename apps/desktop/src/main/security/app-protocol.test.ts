import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mimeTypeFor, resolveAppAssetPath } from './app-protocol';

const root = path.resolve('/srv/renderer');

describe('resolveAppAssetPath', () => {
  it('maps the root and files inside it', () => {
    expect(resolveAppAssetPath(root, 'vozella://app/')).toBe(path.join(root, 'index.html'));
    expect(resolveAppAssetPath(root, 'vozella://app/assets/a.js?x=1')).toBe(
      path.join(root, 'assets', 'a.js'),
    );
  });

  it.each([
    'vozella://app/..%2fsecret.txt',
    'vozella://app/%5c..%5csecret.txt',
    'vozella://app/a%00.js',
    'vozella://other/index.html',
    'https://app/index.html',
    'file:///C:/Windows/win.ini',
    'not a url',
  ])('rejects %s', (url) => {
    expect(resolveAppAssetPath(root, url)).toBeNull();
  });
});

describe('resolveAppAssetPath traversal', () => {
  it.each([
    'vozella://app/../secret.txt',
    'vozella://app/%2e%2e/secret.txt',
    'vozella://app/assets/../../secret.txt',
  ])('never leaves the root for %s', (url) => {
    // The URL parser collapses dot segments, so these land inside the root.
    const resolved = resolveAppAssetPath(root, url);
    expect(resolved === null || resolved.startsWith(root + path.sep)).toBe(true);
  });
});

describe('mimeTypeFor', () => {
  it('knows the build output types and defaults to octet-stream', () => {
    expect(mimeTypeFor('a.js')).toContain('javascript');
    expect(mimeTypeFor('a.CSS')).toContain('css');
    expect(mimeTypeFor('a.woff2')).toBe('font/woff2');
    expect(mimeTypeFor('a.bin')).toBe('application/octet-stream');
  });
});
