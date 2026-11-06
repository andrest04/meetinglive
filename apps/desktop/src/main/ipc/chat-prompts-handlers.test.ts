import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CHAT_PROMPT_LIMIT,
  CHAT_PROMPT_NAME_MAX,
  CHAT_PROMPT_TEXT_MAX,
  type RequestName,
} from '@vozella/contracts';
import {
  USER_PROMPT_LIMIT,
  USER_PROMPT_NAME_MAX,
  USER_PROMPT_TEXT_MAX,
  serializePromptsFile,
  type Logger,
} from '@vozella/core';
import { JsonChatPromptStore } from '@vozella/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatPromptsController,
  type ChatPromptsControllerDeps,
} from '../chat/chat-prompts-controller';
import type { IpcEventLike } from '../security/trusted-origin';
import { registerChatPromptHandlers } from './chat-prompts-handlers';
import type { IpcMainLike } from './ipc-server';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vz-prompt-ipc-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const draft = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  prompt: `Prompt ${name}`,
  availability: 'single',
  engine: null,
  ...over,
});

function setup(over: Partial<ChatPromptsControllerDeps> = {}) {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const events: { name: string; payload: unknown }[] = [];
  let n = 0;
  const store = new JsonChatPromptStore({
    filePath: path.join(dir, 'chat-prompts.json'),
    newId: () => `id-${String((n += 1))}`,
  });
  const controller = new ChatPromptsController({
    store,
    broadcast: (channel, payload) => events.push({ name: channel.name, payload }),
    logger: logger(),
    pickExportPath: () => Promise.resolve(path.join(dir, 'out.vozella-prompts.json')),
    pickImportPath: () => Promise.resolve(path.join(dir, 'in.vozella-prompts.json')),
    readText: (file) => fs.promises.readFile(file, 'utf8'),
    writeText: (file, text) => fs.promises.writeFile(file, text),
    ...over,
  });
  registerChatPromptHandlers({
    server: { ipc, logger: logger(), isTrusted: () => true },
    controller,
  });
  const call = async (name: RequestName, input: unknown = {}): Promise<unknown> => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`no handler for ${name}`);
    const result = (await handler(event as never, input)) as { ok: boolean; value?: unknown };
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`);
    return result.value;
  };
  const changes = () => events.filter((e) => e.name === 'chat.promptsChanged');
  return { call, handlers, events, changes, store };
}

describe('saved prompt handlers (Phase 5)', () => {
  it('core and the wire agree on the limits', () => {
    expect([CHAT_PROMPT_NAME_MAX, CHAT_PROMPT_TEXT_MAX, CHAT_PROMPT_LIMIT]).toEqual([
      USER_PROMPT_NAME_MAX,
      USER_PROMPT_TEXT_MAX,
      USER_PROMPT_LIMIT,
    ]);
  });

  it('registers the six prompt requests', () => {
    const { handlers } = setup();
    for (const name of [
      'chat.prompts.list',
      'chat.prompts.create',
      'chat.prompts.update',
      'chat.prompts.delete',
      'chat.prompts.export',
      'chat.prompts.import',
    ]) {
      expect(handlers.has(name)).toBe(true);
    }
  });

  it('create, update and delete answer values and broadcast the new list', async () => {
    const { call, changes } = setup();
    expect(
      await call('chat.prompts.create', {
        draft: draft(' Risks ', { prompt: ' Prompt Risks ', engine: 'codex' }),
      }),
    ).toEqual({ status: 'saved', prompt: { id: 'id-1', ...draft('Risks', { engine: 'codex' }) } });
    expect(
      await call('chat.prompts.update', { id: 'id-1', draft: draft('Risk list') }),
    ).toMatchObject({
      status: 'saved',
      prompt: { name: 'Risk list', engine: null },
    });
    expect(await call('chat.prompts.update', { id: 'gone', draft: draft('X') })).toEqual({
      status: 'not-found',
    });
    expect(await call('chat.prompts.list')).toEqual({
      prompts: [{ id: 'id-1', ...draft('Risk list') }],
    });
    expect(await call('chat.prompts.delete', { id: 'id-1' })).toEqual({ status: 'deleted' });
    expect(await call('chat.prompts.delete', { id: 'id-1' })).toEqual({ status: 'not-found' });
    expect(changes().map((e) => (e.payload as { prompts: unknown[] }).prompts.length)).toEqual([
      1, 1, 0,
    ]);
  });

  it('a blank name never reaches the store: the wire refuses it', async () => {
    const { handlers } = setup();
    const create = handlers.get('chat.prompts.create');
    const result = (await create?.(event as never, { draft: draft('  ') })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it('a failing store answers failed, never throws', async () => {
    const { call } = setup({
      store: {
        list: () => Promise.reject(new Error('disk')),
        create: () => Promise.reject(new Error('disk')),
        update: () => Promise.reject(new Error('disk')),
        remove: () => Promise.reject(new Error('disk')),
        importMany: () => Promise.reject(new Error('disk')),
      },
    });
    expect(await call('chat.prompts.list')).toEqual({ prompts: [] });
    expect(await call('chat.prompts.create', { draft: draft('A') })).toEqual({ status: 'failed' });
    expect(await call('chat.prompts.delete', { id: 'x' })).toEqual({ status: 'failed' });
  });

  it('export writes version 1 to the picked path; cancel writes nothing', async () => {
    const { call } = setup();
    await call('chat.prompts.create', { draft: draft('One', { engine: 'local' }) });
    expect(await call('chat.prompts.export')).toEqual({ status: 'exported', count: 1 });
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, 'out.vozella-prompts.json'), 'utf8'),
    ) as unknown;
    expect(written).toEqual({ version: 1, prompts: [draft('One', { engine: 'local' })] });

    const cancelled = setup({ pickExportPath: () => Promise.resolve(null) });
    expect(await cancelled.call('chat.prompts.export')).toEqual({ status: 'cancelled' });
  });

  it('import adds the file with taken names renamed "(2)" and broadcasts once', async () => {
    const { call, changes } = setup();
    await call('chat.prompts.create', { draft: draft('Risks') });
    fs.writeFileSync(
      path.join(dir, 'in.vozella-prompts.json'),
      serializePromptsFile([
        { name: 'Risks', prompt: 'a', availability: 'multiple', engine: 'codex' },
        { name: 'Fresh', prompt: 'b', availability: 'single', engine: null },
      ]),
    );
    expect(await call('chat.prompts.import')).toEqual({
      status: 'imported',
      added: 2,
      renamed: 1,
      skipped: 0,
    });
    const { prompts } = (await call('chat.prompts.list')) as { prompts: { name: string }[] };
    expect(prompts.map((p) => p.name)).toEqual(['Risks', 'Risks (2)', 'Fresh']);
    expect(changes()).toHaveLength(2);
  });

  it('import refuses a file that is not a prompts file and adds nothing', async () => {
    const { call, changes } = setup();
    fs.writeFileSync(path.join(dir, 'in.vozella-prompts.json'), '{"version":1,"prompts":[{}]}');
    expect(await call('chat.prompts.import')).toEqual({ status: 'invalid' });
    expect(await call('chat.prompts.list')).toEqual({ prompts: [] });
    expect(changes()).toHaveLength(0);
  });

  it('import: cancel answers cancelled; an unreadable file answers failed', async () => {
    expect(
      await setup({ pickImportPath: () => Promise.resolve(null) }).call('chat.prompts.import'),
    ).toEqual({ status: 'cancelled' });
    expect(await setup().call('chat.prompts.import')).toEqual({ status: 'failed' });
  });
});
