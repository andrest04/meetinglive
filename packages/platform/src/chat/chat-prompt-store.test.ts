import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { USER_PROMPT_LIMIT, type Logger, type UserPromptDraft } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtomicFileOps } from '../fs/atomic-write';
import { JsonChatPromptStore } from './chat-prompt-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vz-prompts-'));
  file = path.join(dir, 'chat-prompts.json');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const draft = (name: string, over: Partial<UserPromptDraft> = {}): UserPromptDraft => ({
  name,
  prompt: `Prompt for ${name}`,
  availability: 'single',
  engine: null,
  ...over,
});

function store(extra: { logger?: Logger; ops?: AtomicFileOps } = {}) {
  let n = 0;
  return new JsonChatPromptStore({
    filePath: file,
    newId: () => `id-${String((n += 1))}`,
    ...extra,
  });
}

const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;

describe('JsonChatPromptStore', () => {
  it('starts empty without a file and writes version 1 with ids on create', async () => {
    const prompts = store();
    expect(await prompts.list()).toEqual([]);
    const saved = await prompts.create(draft('Risks', { engine: 'codex' }));
    expect(saved).toEqual({
      status: 'saved',
      prompt: { id: 'id-1', ...draft('Risks', { engine: 'codex' }) },
    });
    expect(onDisk()).toEqual({
      version: 1,
      prompts: [{ id: 'id-1', ...draft('Risks', { engine: 'codex' }) }],
    });
    expect(await store().list()).toEqual([{ id: 'id-1', ...draft('Risks', { engine: 'codex' }) }]);
  });

  it('updates in place and deletes; unknown ids answer not-found', async () => {
    const prompts = store();
    await prompts.create(draft('One'));
    await prompts.create(draft('Two'));
    expect(await prompts.update('id-1', draft('Uno', { availability: 'multiple' }))).toMatchObject({
      status: 'saved',
      prompt: { id: 'id-1', name: 'Uno', availability: 'multiple' },
    });
    expect((await prompts.list()).map((p) => p.name)).toEqual(['Uno', 'Two']);
    expect(await prompts.update('nope', draft('X'))).toEqual({ status: 'not-found' });
    expect(await prompts.remove('id-1')).toBe(true);
    expect(await prompts.remove('id-1')).toBe(false);
    expect((await prompts.list()).map((p) => p.id)).toEqual(['id-2']);
  });

  it('refuses a draft that breaks the rules', async () => {
    await expect(store().create(draft(' '))).rejects.toThrow(TypeError);
  });

  it('keeps at most 100 prompts', async () => {
    const prompts = store();
    for (let i = 0; i < USER_PROMPT_LIMIT; i += 1) {
      expect((await prompts.create(draft(`P${String(i)}`))).status).toBe('saved');
    }
    expect(await prompts.create(draft('One too many'))).toEqual({ status: 'limit' });
    expect(await prompts.list()).toHaveLength(USER_PROMPT_LIMIT);
  });

  it('writes atomically: a failed rename leaves the old file whole', async () => {
    await store().create(draft('Kept'));
    const before = fs.readFileSync(file, 'utf8');
    const failing: AtomicFileOps = {
      mkdir: (p, o) => fs.promises.mkdir(p, o),
      writeFile: (p, d) => fs.promises.writeFile(p, d),
      rename: () => Promise.reject(Object.assign(new Error('locked'), { code: 'ENOSPC' })),
      unlink: (p) => fs.promises.unlink(p),
    };
    await expect(store({ ops: failing }).create(draft('Lost'))).rejects.toThrow('locked');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.readdirSync(dir)).toEqual(['chat-prompts.json']);
  });

  it('a damaged file loads as empty, is logged, and is set aside on the next write', async () => {
    fs.writeFileSync(file, '{ not json');
    const log = logger();
    const prompts = store({ logger: log });
    expect(await prompts.list()).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(
      'chat-prompts.json is damaged; starting with no prompts',
      expect.anything(),
    );
    await prompts.create(draft('New'));
    expect(fs.readFileSync(`${file}.corrupt`, 'utf8')).toBe('{ not json');
    expect(onDisk()).toMatchObject({ version: 1, prompts: [{ name: 'New' }] });
  });

  it('drops entries that break the rules and keeps the rest', async () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        prompts: [{ id: 'a', ...draft('Good') }, { id: 'b', name: '', prompt: 'x' }, 'junk'],
      }),
    );
    const log = logger();
    expect((await store({ logger: log }).list()).map((p) => p.id)).toEqual(['a']);
    expect(log.warn).toHaveBeenCalledWith('chat-prompts.json had invalid prompts; skipped', {
      skipped: 2,
    });
  });

  it('imports drafts after the saved ones, renaming taken names', async () => {
    const prompts = store();
    await prompts.create(draft('Risks'));
    expect(await prompts.importMany([draft('Risks'), draft('Other')])).toEqual({
      added: 2,
      renamed: 1,
      skipped: 0,
    });
    expect((await prompts.list()).map((p) => p.name)).toEqual(['Risks', 'Risks (2)', 'Other']);
  });
});
