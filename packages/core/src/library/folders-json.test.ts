import { describe, expect, it } from 'vitest';
import { LibraryFileCorruptError } from './errors';
import type { FolderRecord } from './folder';
import { parseFoldersJson, serializeFolders } from './folders-json';

const SAMPLE = [
  '[',
  '  {',
  '    "id": "7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b",',
  '    "name": "Universidad",',
  '    "parentId": null,',
  '    "note": "Fall term",',
  '    "colorKey": "teal",',
  '    "iconKey": "education",',
  '    "createdAt": "2026-09-01T12:00:00-05:00"',
  '  },',
  '  {',
  '    "id": "0b8e6f31-5c2a-4d77-9e10-aa11bb22cc33",',
  '    "name": "Calculo",',
  '    "parentId": "7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b",',
  '    "note": null,',
  '    "colorKey": "blue",',
  '    "iconKey": null,',
  '    "createdAt": "2026-09-02T09:30:00.1234567-05:00"',
  '  }',
  ']',
].join('\r\n');

describe('folders.json', () => {
  it('writes the sample byte for byte, with CRLF', () => {
    expect(serializeFolders(parseFoldersJson(SAMPLE))).toBe(SAMPLE);
  });

  it('reads LF files, any property case, and unknown properties', () => {
    const text =
      '[{"ID":"7D1E0A52-33C4-4F6B-8A90-0C1D2E3F4A5B","Name":"X","createdAt":"2026-09-01T12:00:00Z","extra":1}]';
    expect(parseFoldersJson(text)).toEqual<FolderRecord[]>([
      {
        id: '7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b',
        name: 'X',
        parentId: null,
        note: null,
        colorKey: null,
        iconKey: null,
        createdAt: '2026-09-01T12:00:00+00:00',
      },
    ]);
  });

  it('escapes like the .NET encoder and reads both forms back', () => {
    const folder: FolderRecord = {
      id: '7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b',
      name: 'Año <a> & b+c',
      parentId: null,
      note: 'it\'s "quoted"',
      colorKey: null,
      iconKey: null,
      createdAt: '2026-09-01T12:00:00-05:00',
    };
    const text = serializeFolders([folder]);
    expect(text).toContain('"name": "A\\u00F1o \\u003Ca\\u003E \\u0026 b\\u002Bc"');
    expect(text).toContain('"note": "it\\u0027s \\"quoted\\""');
    expect(parseFoldersJson(text)).toEqual([folder]);
    expect(parseFoldersJson(JSON.stringify([folder]))).toEqual([folder]);
  });

  it('writes an empty list as []', () => {
    expect(serializeFolders([])).toBe('[]');
  });

  it('treats an empty or whitespace file as corrupt, not as no folders', () => {
    expect(() => parseFoldersJson('  ')).toThrow(LibraryFileCorruptError);
  });

  it.each([
    ['not json', '{oops'],
    ['not an array', '{}'],
    [
      'missing name',
      '[{"id":"7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b","createdAt":"2026-09-01T12:00:00Z"}]',
    ],
    ['missing createdAt', '[{"id":"7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b","name":"x"}]'],
    ['bad id', '[{"id":"nope","name":"x","createdAt":"2026-09-01T12:00:00Z"}]'],
  ])('B5: a corrupt file (%s) raises a typed error', (_label, text) => {
    expect(() => parseFoldersJson(text)).toThrow(LibraryFileCorruptError);
  });

  it('strips a BOM', () => {
    expect(parseFoldersJson('﻿[]')).toEqual([]);
  });
});
