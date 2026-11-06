import { describe, expect, it } from 'vitest';
import { CliToolError } from '../summaries/cli-failure';
import { SummaryError } from '../summaries/cli-failure-messages';
import type { LogContext, Logger } from '../logging';
import { ChatService } from './chat-service';
import { createChatRig, guid, meetingFixture, scopeOf, testTranslate } from './chat-test-kit';

const MEETING = guid(7);

/** Pauses the provider before its first chunk. `reached()` resolves once the send is waiting. */
function holdProvider(rig: ReturnType<typeof createChatRig>) {
  let release: () => void = () => undefined;
  let arrived: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => (arrived = resolve));
  rig.provider.beforeChunk = (index) => {
    if (index > 0) return undefined;
    arrived();
    return new Promise<void>((resolve) => (release = resolve));
  };
  return { reached, release: () => release() };
}
const meetingScope = scopeOf({ kind: 'Meeting', meetingId: MEETING });

function rigWithMeeting() {
  const rig = createChatRig();
  rig.reader.meetings = [meetingFixture(7, { transcript: 'We agreed on Friday.' })];
  rig.provider.chunks = ['Friday', ' it is.'];
  return rig;
}

describe('ChatService.send preconditions', () => {
  it('ignores a blank draft', async () => {
    const rig = rigWithMeeting();
    expect(await rig.service.send('  \n ', meetingScope, null)).toEqual({ status: 'ignored' });
    expect(rig.provider.prompts).toHaveLength(0);
  });

  it('ignores a send when the bar is not visible', async () => {
    const rig = rigWithMeeting();
    const out = await rig.service.send('hi', scopeOf({ isVisible: false }), null);
    expect(out.status).toBe('ignored');
  });

  it('ignores a second send while one runs (B1 guard on send)', async () => {
    const rig = rigWithMeeting();
    const hold = holdProvider(rig);
    const first = rig.service.send('one', meetingScope, null);
    await hold.reached;
    expect(await rig.service.send('two', meetingScope, null)).toEqual({ status: 'ignored' });
    hold.release();
    expect((await first).status).toBe('sent');
  });
});

describe('ChatService.send success', () => {
  it('keeps the user then the assistant message with trimmed text', async () => {
    const rig = rigWithMeeting();
    rig.provider.chunks = ['  \n', 'Friday', ' it is.\n'];
    const out = await rig.service.send('  When?  ', meetingScope, null);
    expect(out.status).toBe('sent');
    const { messages, isSending, pending, hasMessages } = rig.service.state;
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'When?'],
      ['assistant', 'Friday it is.'],
    ]);
    expect(isSending).toBe(false);
    expect(pending).toBeNull();
    expect(hasMessages).toBe(true);
  });

  it('reads only the meeting by id for a meeting scope (B17)', async () => {
    const rig = rigWithMeeting();
    await rig.service.send('When?', meetingScope, null);
    expect(rig.reader.calls).toEqual([`byId:${MEETING}`]);
  });

  it('reads the folder and its meetings for a folder scope, everything for all', async () => {
    const rig = rigWithMeeting();
    await rig.service.send('x', scopeOf({ kind: 'Folder', folderId: guid(1001) }), null);
    expect(rig.reader.calls).toEqual([`folder:${guid(1001)}`, 'folders']);
    rig.reader.calls.length = 0;
    await rig.service.send('x', scopeOf(), null);
    expect(rig.reader.calls).toEqual(['recent', 'folders']);
  });

  it('gives the two messages their own timestamps (B7)', async () => {
    const rig = rigWithMeeting();
    rig.provider.beforeChunk = () => rig.clock.advance(500);
    const out = await rig.service.send('When?', meetingScope, null);
    if (out.status !== 'sent') throw new Error('expected sent');
    expect(out.assistant.createdAt.getTime() - out.user.createdAt.getTime()).toBe(1000);
  });

  it('sends earlier turns of the same scope as prior turns', async () => {
    const rig = rigWithMeeting();
    await rig.service.send('First question', meetingScope, null);
    await rig.service.send('Second question', meetingScope, null);
    const prompt = rig.provider.prompts[1] ?? '';
    expect(prompt).toContain('user: First question');
    expect(prompt).toContain('assistant: Friday it is.');
    expect(rig.service.state.messages).toHaveLength(4);
  });

  it('starts a new conversation when the scope differs', async () => {
    const rig = rigWithMeeting();
    await rig.service.send('First question', meetingScope, null);
    await rig.service.send('Other scope', scopeOf(), null);
    expect(rig.provider.prompts[1]).not.toContain('First question');
    expect(rig.service.state.messages.map((m) => m.text)).toEqual(['Other scope', 'Friday it is.']);
  });

  it('streams partial text to the pending row, at most one push per 80 ms', async () => {
    const rig = rigWithMeeting();
    rig.provider.chunks = ['a', 'b', 'c'];
    rig.provider.beforeChunk = (i) => {
      if (i === 2) rig.clock.advance(80);
    };
    const seen: string[] = [];
    rig.service.onChange(() => {
      const p = rig.service.state.pending;
      if (p !== null && p.assistantText !== '' && seen.at(-1) !== p.assistantText) {
        seen.push(p.assistantText);
      }
    });
    await rig.service.send('go', meetingScope, null);
    expect(seen).toEqual(['a', 'abc']);
  });
});

describe('B5 snapshot', () => {
  it('packs the live transcript given at send start', async () => {
    const rig = createChatRig();
    rig.provider.chunks = ['ok'];
    await rig.service.send('summary?', scopeOf({ kind: 'Live' }), 'first words');
    expect(rig.provider.prompts[0]).toContain('first words');
  });

  it('Live scope with an empty transcript stays sendable (Section 7)', async () => {
    const rig = createChatRig();
    rig.provider.chunks = ['ok'];
    for (const live of ['', '   \n', null]) {
      const out = await rig.service.send('what now?', scopeOf({ kind: 'Live' }), live);
      expect(out.status).toBe('sent');
    }
    expect(rig.provider.prompts).toHaveLength(3);
    expect(rig.provider.prompts[0]).toContain('The live transcript is empty.');
  });

  it('passes no output language to the prompt or the provider call (S8)', async () => {
    const rig = rigWithMeeting();
    const args: unknown[][] = [];
    const original = rig.provider.streamPrompt.bind(rig.provider);
    rig.provider.streamPrompt = (...a: Parameters<typeof original>) => {
      args.push(a);
      return original(...a);
    };
    await rig.service.send('When?', meetingScope, null);
    expect(args[0]).toHaveLength(2);
    expect(rig.provider.prompts[0]).not.toMatch(/language/i);
  });

  it('keeps the scope of the send even if the scope changes while it runs', async () => {
    const rig = rigWithMeeting();
    const hold = holdProvider(rig);
    const send = rig.service.send('When?', meetingScope, null);
    await hold.reached;
    rig.service.applyScope(rig.service.beginScopeRefresh(), scopeOf());
    hold.release();
    await send;
    expect(rig.provider.prompts[0]).toContain('Scope: Meeting');
  });
});

describe('failures keep nothing and return the draft', () => {
  it('provider error: Chat_SendFailed with a mapped message, never the raw one (B14)', async () => {
    const rig = rigWithMeeting();
    rig.provider.chunks = [];
    rig.provider.failWith = new CliToolError('Claude Code', 'NotSignedIn', 'raw secret detail');
    const out = await rig.service.send(' hello ', meetingScope, null);
    expect(out).toMatchObject({ status: 'failed', originalDraft: ' hello ' });
    if (out.status !== 'failed') throw new Error('expected failed');
    expect(out.failure.message).toBe('Could not answer. Sign in to Claude Code first.');
    expect(out.failure.message).not.toContain('raw secret');
    expect(rig.service.state.messages).toEqual([]);
    expect(rig.service.state.isSending).toBe(false);
  });

  it('a local budget failure becomes the plain too-long sentence', async () => {
    const rig = rigWithMeeting();
    rig.provider.chunks = [];
    rig.provider.failWith = new SummaryError('PromptTooLong');
    const out = await rig.service.send('hello', meetingScope, null);
    if (out.status !== 'failed') throw new Error('expected failed');
    expect(out.failure.message).toBe(
      'Could not answer. The text is too long for the local summary model.',
    );
  });

  it('a reader failure is a send failure and nothing is kept', async () => {
    const rig = rigWithMeeting();
    rig.reader.failWith = new Error('disk');
    const out = await rig.service.send('hello', meetingScope, null);
    expect(out.status).toBe('failed');
    expect(rig.service.state.messages).toEqual([]);
  });

  it('an empty answer gives Chat_EmptyAnswer and keeps nothing', async () => {
    const rig = rigWithMeeting();
    rig.provider.chunks = ['  ', '\n'];
    const out = await rig.service.send('hello', meetingScope, null);
    expect(out).toMatchObject({
      status: 'failed',
      failure: { kind: 'empty-answer', message: 'The answer came back empty.' },
      originalDraft: 'hello',
    });
    expect(rig.service.state.messages).toEqual([]);
  });

  it('a failed send leaves an earlier conversation untouched', async () => {
    const rig = rigWithMeeting();
    await rig.service.send('first', meetingScope, null);
    rig.provider.chunks = [];
    rig.provider.failWith = new Error('x');
    await rig.service.send('second', meetingScope, null);
    expect(rig.service.state.messages).toHaveLength(2);
  });
});

describe('provider setup', () => {
  it('returns setup-required without a gate and keeps nothing', async () => {
    const rig = rigWithMeeting();
    rig.source.resolution = { status: 'needs-setup', kind: 'Local' };
    const out = await rig.service.send('hello', meetingScope, null);
    expect(out).toEqual({ status: 'setup-required', kind: 'Local', originalDraft: 'hello' });
    expect(rig.service.state.isSending).toBe(false);
  });

  it('a cancelled gate gives Status_SetupCancelled without the Could not answer prefix', async () => {
    const rig = rigWithMeeting();
    rig.source.resolution = { status: 'needs-setup', kind: 'Codex' };
    const out = await rig.service.send('hello', meetingScope, null, {
      setupGate: () => Promise.resolve(null),
    });
    expect(out).toMatchObject({
      status: 'failed',
      failure: { kind: 'setup-cancelled', message: 'Setup cancelled.' },
    });
  });

  it('a gate that finishes setup lets the send go on', async () => {
    const rig = rigWithMeeting();
    rig.source.resolution = { status: 'needs-setup', kind: 'Local' };
    const out = await rig.service.send('hello', meetingScope, null, {
      setupGate: () => Promise.resolve(rig.provider),
    });
    expect(out.status).toBe('sent');
  });

  it('a removed provider asks for another one', async () => {
    const rig = rigWithMeeting();
    rig.source.resolution = { status: 'unavailable' };
    const out = await rig.service.send('hello', meetingScope, null);
    expect(out).toMatchObject({
      status: 'failed',
      failure: { kind: 'provider-removed', message: 'Grok (xAI) is no longer available.' },
    });
  });
});

describe('cancel (B19, B20)', () => {
  it('a cancelled send is silent, keeps nothing and discards the partial answer', async () => {
    const rig = rigWithMeeting();
    rig.provider.chunks = ['partial ', 'answer', ' more'];
    rig.provider.beforeChunk = (i) => {
      if (i === 2) rig.service.cancel();
    };
    const out = await rig.service.send('hello', meetingScope, null);
    expect(out).toEqual({ status: 'cancelled', originalDraft: 'hello' });
    expect(rig.service.state.messages).toEqual([]);
    expect(rig.service.state.isSending).toBe(false);
    expect(rig.service.state.pending).toBeNull();
  });

  it('cancel with no send running does nothing', () => {
    const rig = rigWithMeeting();
    expect(() => rig.service.cancel()).not.toThrow();
  });

  it('a provider that ignores the cancel and answers is still dropped', async () => {
    const rig = rigWithMeeting();
    rig.provider.beforeChunk = (i) => {
      if (i === 0) rig.service.cancel();
    };
    // the scripted provider throws on cancel, so script a quiet one instead
    rig.source.resolution = {
      status: 'ready',
      provider: {
        streamPrompt: async function* () {
          await Promise.resolve();
          rig.service.cancel();
          yield 'late answer';
        },
      },
    };
    const out = await rig.service.send('hello', meetingScope, null);
    expect(out.status).toBe('cancelled');
    expect(rig.service.state.messages).toEqual([]);
  });

  it('can send again after a cancel', async () => {
    const rig = rigWithMeeting();
    rig.provider.beforeChunk = (i) => {
      if (i === 0) rig.service.cancel();
    };
    await rig.service.send('one', meetingScope, null);
    rig.provider.beforeChunk = null;
    expect((await rig.service.send('two', meetingScope, null)).status).toBe('sent');
  });
});

describe('new chat and scope (B1, B24, parity 18)', () => {
  it('refuses New chat while sending and exposes the state for the control (B1)', async () => {
    const rig = rigWithMeeting();
    const hold = holdProvider(rig);
    const send = rig.service.send('hello', meetingScope, null);
    await hold.reached;
    expect(rig.service.state.canStartNewChat).toBe(false);
    expect(rig.service.newChat()).toBe(false);
    hold.release();
    await send;
    expect(rig.service.state.canStartNewChat).toBe(true);
    expect(rig.service.newChat()).toBe(true);
    expect(rig.service.state.messages).toEqual([]);
    expect(rig.service.state.hasMessages).toBe(false);
  });

  it('recomputes the mismatch banner while sending (B24)', async () => {
    const rig = rigWithMeeting();
    rig.service.applyScope(rig.service.beginScopeRefresh(), meetingScope);
    await rig.service.send('first', meetingScope, null);
    expect(rig.service.state.showScopeMismatch).toBe(false);

    const hold = holdProvider(rig);
    const send = rig.service.send('again', meetingScope, null);
    await hold.reached;
    rig.service.applyScope(rig.service.beginScopeRefresh(), scopeOf());
    expect(rig.service.state.showScopeMismatch).toBe(true);
    hold.release();
    await send;
  });

  it('hides the mismatch banner when the bar is not visible', async () => {
    const rig = rigWithMeeting();
    await rig.service.send('first', meetingScope, null);
    rig.service.applyScope(rig.service.beginScopeRefresh(), scopeOf({ isVisible: false }));
    expect(rig.service.state.showScopeMismatch).toBe(false);
  });

  it('discards a stale scope refresh result', () => {
    const rig = rigWithMeeting();
    const older = rig.service.beginScopeRefresh();
    const newer = rig.service.beginScopeRefresh();
    expect(rig.service.applyScope(newer, meetingScope)).toBe(true);
    expect(rig.service.applyScope(older, scopeOf())).toBe(false);
    expect(rig.service.scope).toEqual(meetingScope);
  });

  it('tells listeners about state changes and stops after unsubscribe', async () => {
    const rig = rigWithMeeting();
    let calls = 0;
    const off = rig.service.onChange(() => (calls += 1));
    await rig.service.send('hello', meetingScope, null);
    expect(calls).toBeGreaterThan(2);
    off();
    const before = calls;
    rig.service.newChat();
    expect(calls).toBe(before);
  });
});

describe('ChatService stream timing', () => {
  class RecordingLogger implements Logger {
    readonly entries: { level: string; message: string; context?: LogContext }[] = [];
    debug(message: string, context?: LogContext): void {
      this.entries.push({ level: 'debug', message, context });
    }
    info(message: string, context?: LogContext): void {
      this.entries.push({ level: 'info', message, context });
    }
    warn(message: string, context?: LogContext): void {
      this.entries.push({ level: 'warn', message, context });
    }
    error(message: string, context?: LogContext): void {
      this.entries.push({ level: 'error', message, context });
    }
  }

  function rigWithLogger() {
    const rig = rigWithMeeting();
    const logger = new RecordingLogger();
    const service = new ChatService({
      meetings: rig.reader,
      providers: rig.source,
      clock: rig.clock,
      translate: testTranslate as never,
      newId: () => 'id',
      logger,
    });
    return { rig, service, logger };
  }

  it('logs the time to the first chunk and the total, with the chunk count', async () => {
    const { rig, service, logger } = rigWithLogger();
    rig.provider.chunks = ['Friday', ' it', ' is.'];
    rig.provider.beforeChunk = (index) => {
      rig.clock.advance(index === 0 ? 1200 : 100);
      return undefined;
    };
    expect((await service.send('When?', meetingScope, null)).status).toBe('sent');
    expect(logger.entries).toEqual([
      {
        level: 'info',
        message: 'chat answer streamed',
        context: { firstChunkMs: 1200, totalMs: 1400, chunks: 3, chars: 13 },
      },
    ]);
  });

  it('logs no first chunk time when nothing arrived, and works without a logger', async () => {
    const { rig, service, logger } = rigWithLogger();
    rig.provider.chunks = [];
    await service.send('When?', meetingScope, null);
    expect(logger.entries[0]?.context).toMatchObject({ firstChunkMs: null, chunks: 0 });
    const plain = rigWithMeeting();
    expect((await plain.service.send('When?', meetingScope, null)).status).toBe('sent');
  });
});
