import { describe, expect, it } from 'vitest';
import {
  CHAT_PROMPT_LIMIT,
  CHAT_PROMPT_NAME_MAX,
  CHAT_PROMPT_TEXT_MAX,
  chatPromptDraftSchema,
  chatPromptsChanged,
  chatPromptsCreate,
  chatPromptsDelete,
  chatPromptsExport,
  chatPromptsImport,
  chatPromptsList,
  chatPromptsUpdate,
  chatSend,
  eventChannels,
  requestChannels,
} from './index';

const scope = { isVisible: true, kind: 'Meeting', folderId: null, meetingId: 'm-1' } as const;
const draft = { name: 'Risks', prompt: 'List the risks.', availability: 'single', engine: null };

describe('saved prompt contracts (Phase 5)', () => {
  it('registers the prompt requests and the change event by name', () => {
    for (const channel of [
      chatPromptsList,
      chatPromptsCreate,
      chatPromptsUpdate,
      chatPromptsDelete,
      chatPromptsExport,
      chatPromptsImport,
    ]) {
      expect(requestChannels[channel.name]).toBe(channel);
    }
    expect(eventChannels[chatPromptsChanged.name]).toBe(chatPromptsChanged);
  });

  it('a draft trims its text and keeps the limits: name 1-60, prompt 1-4000', () => {
    expect(chatPromptDraftSchema.parse({ ...draft, name: '  Risks  ' }).name).toBe('Risks');
    expect(chatPromptDraftSchema.safeParse({ ...draft, name: ' ' }).success).toBe(false);
    expect(
      chatPromptDraftSchema.safeParse({ ...draft, name: 'x'.repeat(CHAT_PROMPT_NAME_MAX + 1) })
        .success,
    ).toBe(false);
    expect(
      chatPromptDraftSchema.safeParse({ ...draft, prompt: 'x'.repeat(CHAT_PROMPT_TEXT_MAX) })
        .success,
    ).toBe(true);
    expect(
      chatPromptDraftSchema.safeParse({ ...draft, prompt: 'x'.repeat(CHAT_PROMPT_TEXT_MAX + 1) })
        .success,
    ).toBe(false);
    expect(CHAT_PROMPT_LIMIT).toBe(100);
  });

  it('availability is single or multiple and the engine one of three, or null', () => {
    expect(chatPromptDraftSchema.safeParse({ ...draft, availability: 'live' }).success).toBe(false);
    for (const engine of ['claude-code', 'codex', 'local', null]) {
      expect(chatPromptDraftSchema.safeParse({ ...draft, engine }).success).toBe(true);
    }
    expect(chatPromptDraftSchema.safeParse({ ...draft, engine: 'xai' }).success).toBe(false);
  });

  it('the list answers at most 100 prompts', () => {
    const prompts = Array.from({ length: 101 }, (_, i) => ({ ...draft, id: `p${String(i)}` }));
    expect(chatPromptsList.output.safeParse({ prompts }).success).toBe(false);
    expect(chatPromptsList.output.safeParse({ prompts: prompts.slice(1) }).success).toBe(true);
  });

  it('create and update answer saved, limit or not-found', () => {
    const saved = { status: 'saved', prompt: { ...draft, id: 'p1' } };
    expect(chatPromptsCreate.output.parse(saved)).toEqual(saved);
    expect(chatPromptsCreate.output.parse({ status: 'limit' })).toEqual({ status: 'limit' });
    expect(chatPromptsUpdate.input.parse({ id: 'p1', draft })).toEqual({ id: 'p1', draft });
    expect(chatPromptsUpdate.output.parse({ status: 'not-found' })).toEqual({
      status: 'not-found',
    });
  });

  it('import and export outcomes are values', () => {
    expect(
      chatPromptsImport.output.parse({ status: 'imported', added: 2, renamed: 1, skipped: 0 }),
    ).toMatchObject({ status: 'imported' });
    expect(chatPromptsImport.output.parse({ status: 'invalid' })).toEqual({ status: 'invalid' });
    expect(chatPromptsExport.output.parse({ status: 'exported', count: 3 })).toMatchObject({
      count: 3,
    });
    expect(chatPromptsExport.output.parse({ status: 'cancelled' })).toEqual({
      status: 'cancelled',
    });
  });

  it('chat.send takes an optional engine for that send only', () => {
    const base = { requestId: 'r', draft: 'hi', scope, liveTranscript: null };
    expect(chatSend.input.parse(base)).not.toHaveProperty('engine');
    expect(chatSend.input.parse({ ...base, engine: 'codex' }).engine).toBe('codex');
    expect(chatSend.input.safeParse({ ...base, engine: 'grok' }).success).toBe(false);
  });
});
