import { describe, expect, it } from 'vitest';
import {
  chatCancel,
  chatCopyText,
  chatMeetingExists,
  chatOpenExternal,
  chatSend,
  chatSendOutcomeSchema,
  chatSetScope,
  eventChannels,
  requestChannels,
} from './index';

const scope = { isVisible: true, kind: 'Meeting', folderId: null, meetingId: 'm-1' } as const;
const message = (role: 'user' | 'assistant') => ({
  id: 'x',
  role,
  text: 't',
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('chat contracts', () => {
  it('registers every chat request and event by name', () => {
    for (const name of [
      'chat.send',
      'chat.cancel',
      'chat.newChat',
      'chat.state',
      'chat.setScope',
      'chat.meetingExists',
      'chat.copyText',
      'chat.openExternal',
    ]) {
      expect(Object.keys(requestChannels)).toContain(name);
    }
    expect(Object.keys(eventChannels)).toContain('chat.chunk');
    expect(Object.keys(eventChannels)).toContain('chat.stateChanged');
  });

  it('accepts a send with a scope and a live transcript snapshot', () => {
    const input = { requestId: 'r1', draft: 'hi', scope, liveTranscript: null };
    expect(chatSend.input.safeParse(input).success).toBe(true);
    expect(chatSend.input.safeParse({ ...input, liveTranscript: 'Ana: hi' }).success).toBe(true);
  });

  it('refuses a send with a missing request id, an unknown scope kind or no transcript field', () => {
    const input = { requestId: 'r1', draft: 'hi', scope, liveTranscript: null };
    expect(chatSend.input.safeParse({ ...input, requestId: '' }).success).toBe(false);
    expect(
      chatSend.input.safeParse({ ...input, scope: { ...scope, kind: 'Everything' } }).success,
    ).toBe(false);
    expect(chatSetScope.input.safeParse({ scope: { ...scope, isVisible: 'yes' } }).success).toBe(
      false,
    );
    expect(chatSend.input.safeParse({ requestId: 'r1', draft: 'hi', scope }).success).toBe(false);
  });

  it('every send outcome is a value the schema accepts', () => {
    const outcomes: unknown[] = [
      { status: 'answered', user: message('user'), assistant: message('assistant') },
      { status: 'setup-required', kind: 'Local', originalDraft: 'q' },
      { status: 'failed', kind: 'send-failed', message: 'm', originalDraft: 'q' },
      { status: 'cancelled', originalDraft: 'q' },
      { status: 'empty' },
    ];
    for (const outcome of outcomes) {
      expect(chatSendOutcomeSchema.safeParse(outcome).success).toBe(true);
    }
    expect(chatSendOutcomeSchema.safeParse({ status: 'setup-required', kind: 'Xai' }).success).toBe(
      false,
    );
    expect(chatSendOutcomeSchema.safeParse({ status: 'failed', message: 'm' }).success).toBe(false);
  });

  it('refuses malformed small requests', () => {
    expect(chatCancel.input.safeParse({ extra: 1 }).success).toBe(false);
    expect(chatCopyText.input.safeParse({ text: '' }).success).toBe(false);
    expect(chatMeetingExists.input.safeParse({ meetingId: '' }).success).toBe(false);
    expect(chatOpenExternal.input.safeParse({ url: 'https://a.test' }).success).toBe(true);
    expect(chatOpenExternal.input.safeParse({ url: '' }).success).toBe(false);
  });
});
