import { describe, expect, it } from 'vitest';
import { FoldedTextCache, foldedTextBytes } from './folded-text-cache';

const text = (size: number) => ({
  title: 'x'.repeat(size),
  summary: '',
  notes: '',
  transcript: '',
});

describe('foldedTextBytes', () => {
  it('counts one byte a character for Latin text and two otherwise', () => {
    expect(foldedTextBytes({ title: 'abc', summary: 'de', notes: '', transcript: '' })).toBe(5);
    expect(foldedTextBytes({ title: '日本', summary: 'de', notes: '', transcript: '' })).toBe(6);
  });
});

describe('FoldedTextCache', () => {
  it('returns text only for the same file version', () => {
    const cache = new FoldedTextCache(100);
    cache.set('a', 1, 10, text(5));
    expect(cache.get('a', 1, 10)).toEqual(text(5));
    expect(cache.get('a', 2, 10)).toBeUndefined();
    expect(cache.get('a', 1, 10)).toBeUndefined();
    expect(cache.get('b', 1, 10)).toBeUndefined();
  });

  it('stays under the cap by dropping what the last two searches did not use', () => {
    const cache = new FoldedTextCache(100);
    cache.set('old', 1, 1, text(60));
    cache.beginPass();
    cache.beginPass();
    cache.set('new', 1, 1, text(60));
    expect(cache.bytes).toBe(60);
    expect(cache.get('old', 1, 1)).toBeUndefined();
    expect(cache.get('new', 1, 1)).toEqual(text(60));
  });

  it('counts a replaced version once', () => {
    const cache = new FoldedTextCache(100);
    cache.set('a', 1, 1, text(60));
    cache.set('a', 2, 1, text(70));
    expect(cache.bytes).toBe(70);
  });

  it('never holds a file bigger than the cap', () => {
    const cache = new FoldedTextCache(10);
    cache.set('a', 1, 1, text(11));
    expect(cache.bytes).toBe(0);
    expect(cache.get('a', 1, 1)).toBeUndefined();
  });

  it('keeps a stable set when a library larger than the cap is searched over and over', () => {
    // Plain LRU would lose every entry to a repeated full scan and never hit once.
    const cache = new FoldedTextCache(30);
    const paths = ['a', 'b', 'c', 'd', 'e', 'f'];
    const scan = (): number => {
      cache.beginPass();
      let hits = 0;
      for (const path of paths) {
        if (cache.get(path, 1, 1)) hits += 1;
        else cache.set(path, 1, 1, text(10));
      }
      return hits;
    };
    expect(scan()).toBe(0);
    expect(scan()).toBe(3);
    expect(scan()).toBe(3);
    expect(cache.bytes).toBeLessThanOrEqual(30);
  });

  it('lets entries the searches stopped using make way for ones they use', () => {
    const cache = new FoldedTextCache(20);
    cache.set('a', 1, 1, text(10));
    cache.set('b', 1, 1, text(10));
    cache.beginPass();
    cache.beginPass();
    cache.get('b', 1, 1);
    cache.set('c', 1, 1, text(10));
    expect(cache.get('a', 1, 1)).toBeUndefined();
    expect(cache.get('b', 1, 1)).toEqual(text(10));
    expect(cache.get('c', 1, 1)).toEqual(text(10));
  });
});
