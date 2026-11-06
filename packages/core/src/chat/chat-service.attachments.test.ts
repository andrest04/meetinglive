import { describe, expect, it } from 'vitest';
import type {
  AttachedDocument,
  ChatAttachmentSource,
  ResolvedAttachments,
  StagedImages,
} from './attachments';
import { ChatService } from './chat-service';
import {
  FakeChatMeetingReader,
  FakeProviderSource,
  ManualClock,
  ScriptedChatProvider,
  guid,
  meetingFixture,
  scopeOf,
  testTranslate,
} from './chat-test-kit';

const MEETING = guid(7);
const scope = scopeOf({ kind: 'Meeting', meetingId: MEETING });

const planPdf: AttachedDocument = {
  name: 'plan.pdf',
  kind: 'pdf',
  pages: 2,
  truncated: false,
  sections: [
    { location: { kind: 'page', n: 1 }, text: 'Intro.' },
    { location: { kind: 'page', n: 2 }, text: 'The budget is 10k.' },
  ],
};

/** A source over fixed files. It records the ids asked for and whether staged copies were freed. */
class FakeAttachmentSource implements ChatAttachmentSource {
  readonly resolved: (readonly string[])[] = [];
  readonly staged: (readonly string[])[] = [];
  released = 0;
  files: ResolvedAttachments = { documents: [planPdf], imageNames: [] };

  resolve(ids: readonly string[]): Promise<ResolvedAttachments> {
    this.resolved.push(ids);
    return Promise.resolve(this.files);
  }

  stageImages(ids: readonly string[]): Promise<StagedImages | null> {
    this.staged.push(ids);
    if (this.files.imageNames.length === 0) return Promise.resolve(null);
    return Promise.resolve({
      directory: '/tmp/vz-send',
      paths: this.files.imageNames.map((_, i) => `/tmp/vz-send/image-${String(i + 1)}.png`),
      names: this.files.imageNames,
      release: () => {
        this.released += 1;
        return Promise.resolve();
      },
    });
  }
}

function rig(providerId: 'claude-code' | 'codex' | 'local') {
  const reader = new FakeChatMeetingReader();
  reader.meetings = [meetingFixture(7, { transcript: 'We agreed on Friday.' })];
  const provider = new ScriptedChatProvider();
  provider.id = providerId;
  provider.chunks = ['Answer.'];
  const attachments = new FakeAttachmentSource();
  let n = 0;
  const service = new ChatService({
    meetings: reader,
    providers: new FakeProviderSource({ status: 'ready', provider }),
    clock: new ManualClock(),
    translate: testTranslate as never,
    newId: () => `id-${String((n += 1))}`,
    attachments,
  });
  return { service, provider, attachments };
}

describe('ChatService with attached files', () => {
  it('packs the files after the meeting context, with the file rules', async () => {
    const { service, provider, attachments } = rig('claude-code');
    const outcome = await service.send('What is the budget?', scope, null, {
      attachmentIds: ['a1'],
    });
    expect(outcome.status).toBe('sent');
    expect(attachments.resolved).toEqual([['a1']]);
    const prompt = provider.prompts[0] ?? '';
    expect(prompt).toContain('# Attached files\nFile: plan.pdf (PDF, 2 pages)\n[page 1]\nIntro.');
    expect(prompt).toContain('(<file name>, p. N)');
    expect(prompt.indexOf('We agreed on Friday.')).toBeLessThan(prompt.indexOf('File: plan.pdf'));
  });

  it('sends no file section and reads no source without attachment ids', async () => {
    const { service, provider, attachments } = rig('claude-code');
    await service.send('Hi', scope, null);
    expect(attachments.resolved).toEqual([]);
    expect(provider.prompts[0]).not.toContain('# Attached files');
  });

  it('keeps files within the small local budget', async () => {
    const { service, provider, attachments } = rig('local');
    attachments.files = {
      documents: [{ ...planPdf, sections: [{ location: null, text: 'word '.repeat(4000) }] }],
      imageNames: [],
    };
    await service.send('word?', scope, null, { attachmentIds: ['a1'] });
    const prompt = provider.prompts[0] ?? '';
    const files = prompt.slice(prompt.indexOf('# Attached files'), prompt.indexOf('# Prior turns'));
    expect(files.length).toBeLessThan(2_600);
  });

  it('hands staged images to a CLI engine and frees the copies after the answer', async () => {
    const { service, provider, attachments } = rig('claude-code');
    attachments.files = { documents: [], imageNames: ['board.png'] };
    const outcome = await service.send('What is on the board?', scope, null, {
      attachmentIds: ['img'],
    });
    expect(outcome).toMatchObject({ status: 'sent', notice: null });
    expect(provider.options[0]?.images).toEqual({
      directory: '/tmp/vz-send',
      paths: ['/tmp/vz-send/image-1.png'],
    });
    expect(provider.prompts[0]).toContain('The user attached these images: board.png.');
    expect(provider.prompts[0]).toContain('Read tool');
    expect(attachments.released).toBe(1);
  });

  it('Codex sees the images without the Read tool hint', async () => {
    const { service, provider, attachments } = rig('codex');
    attachments.files = { documents: [], imageNames: ['board.png'] };
    await service.send('q', scope, null, { attachmentIds: ['img'] });
    expect(provider.prompts[0]).toContain('The user attached these images: board.png.');
    expect(provider.prompts[0]).not.toContain('Read tool');
  });

  it('frees the staged images when the engine fails', async () => {
    const { service, provider, attachments } = rig('codex');
    attachments.files = { documents: [], imageNames: ['board.png'] };
    provider.failWith = new Error('boom');
    const outcome = await service.send('q', scope, null, { attachmentIds: ['img'] });
    expect(outcome.status).toBe('failed');
    expect(attachments.released).toBe(1);
  });

  it('the local engine answers without the images and says so', async () => {
    const { service, provider, attachments } = rig('local');
    attachments.files = { documents: [planPdf], imageNames: ['board.png'] };
    const outcome = await service.send('q', scope, null, { attachmentIds: ['img', 'a1'] });
    expect(outcome).toMatchObject({ status: 'sent', notice: 'Ui_ChatAttachImagesLocal' });
    expect(attachments.staged).toEqual([]);
    expect(provider.options[0]?.images).toBeUndefined();
    expect(provider.prompts[0]).not.toContain('board.png');
    expect(provider.prompts[0]).toContain('File: plan.pdf');
  });
});
