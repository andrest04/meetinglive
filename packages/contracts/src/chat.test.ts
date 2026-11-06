import { describe, expect, it } from 'vitest';
import {
  chatAttachDrop,
  chatAttachList,
  chatAttachPick,
  chatAttachRemove,
  chatCancel,
  chatCopyText,
  chatMeetingExists,
  chatOpenExternal,
  chatSend,
  chatSendOutcomeSchema,
  chatSetScope,
  chatState,
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

describe('chat attachment contracts', () => {
  const attachment = {
    id: 'att-1',
    name: 'plan.pdf',
    kind: 'pdf',
    sizeBytes: 1200,
    pages: 2,
    status: 'ready',
    message: null,
    truncated: false,
  } as const;

  it('registers the attach requests', () => {
    for (const name of [
      'chat.attach.pick',
      'chat.attach.drop',
      'chat.attach.remove',
      'chat.attach.list',
    ]) {
      expect(Object.keys(requestChannels)).toContain(name);
    }
  });

  it('send carries at most 10 attachment ids, and none by default', () => {
    const base = { requestId: 'r', draft: 'q', scope, liveTranscript: null };
    expect(chatSend.input.parse(base).attachmentIds).toEqual([]);
    expect(chatSend.input.parse({ ...base, attachmentIds: ['a'] }).attachmentIds).toEqual(['a']);
    const eleven = Array.from({ length: 11 }, (_, i) => `a${String(i)}`);
    expect(chatSend.input.safeParse({ ...base, attachmentIds: eleven }).success).toBe(false);
  });

  it('the list answer carries chips and an optional notice', () => {
    const parsed = chatAttachPick.output.parse({ attachments: [attachment], notice: null });
    expect(parsed.attachments[0]?.kind).toBe('pdf');
    expect(
      chatAttachList.output.safeParse({
        attachments: [{ ...attachment, kind: 'exe' }],
        notice: null,
      }).success,
    ).toBe(false);
  });

  it('drop takes 1 to 10 paths of bounded length; remove takes an id', () => {
    expect(chatAttachDrop.input.safeParse({ paths: [] }).success).toBe(false);
    expect(chatAttachDrop.input.safeParse({ paths: ['/tmp/a.txt'] }).success).toBe(true);
    expect(chatAttachDrop.input.safeParse({ paths: ['x'.repeat(5000)] }).success).toBe(false);
    expect(chatAttachRemove.input.safeParse({ id: 'att-1' }).success).toBe(true);
  });

  it('an answer may carry a notice, null by default', () => {
    const answered = chatSendOutcomeSchema.parse({
      status: 'answered',
      user: message('user'),
      assistant: message('assistant'),
    });
    expect(answered).toMatchObject({ notice: null });
  });

  it('the chat state lists the attachments, empty by default', () => {
    const state = chatState.output.parse({
      messages: [],
      isSending: false,
      showScopeMismatch: false,
      hasMessages: false,
      canStartNewChat: true,
    });
    expect(state.attachments).toEqual([]);
  });
});
