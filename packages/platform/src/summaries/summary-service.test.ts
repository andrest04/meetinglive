import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CancelSource,
  InMemorySettingsStore,
  SummaryService,
  type JevAnalysis,
  type MeetingRecord,
  type SummaryProvider,
} from '@vozella/core';
import { createLibraryFixture, type LibraryFixture } from '../library/library-test-kit';

/** Item 112 and 4.2: a generate on files written by the WinUI app keeps every other field. */
const source = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'library',
  'fixtures',
  'winui-library',
);
const WEEKLY = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';

let fx: LibraryFixture;
beforeEach(() => {
  fx = createLibraryFixture();
  fs.cpSync(source, fx.root, { recursive: true });
  fs.rmSync(path.join(fx.root, '.gitattributes'));
  fs.renameSync(path.join(fx.root, 'folders.json.fixture'), path.join(fx.root, 'folders.json'));
});
afterEach(() => {
  fx.cleanup();
});

const provider: SummaryProvider = {
  id: 'codex',
  summarize: () =>
    Promise.resolve({
      summaryMarkdown: '### Fresh\nNew text',
      actionItems: [{ text: 'Call Ana', isDone: false }],
      providerId: 'codex' as const,
      suggestedTitle: 'Ignored for a real title',
    }),
} as unknown as SummaryProvider;

const service = (notified: string[]) =>
  new SummaryService({
    meetings: fx.meetings,
    settings: new InMemorySettingsStore(),
    resolver: {
      resolveSummaryProvider: () => Promise.resolve({ status: 'ready', kind: 'Codex', provider }),
    },
    clock: { now: () => new Date('2026-09-05T15:00:00.000Z') },
    notifyMeetingChanged: (id) => notified.push(id),
  });

const generate = (s: SummaryService, id: string, templateId?: string | null) =>
  s.generate({
    meetingId: id,
    regenerate: true,
    cancel: new CancelSource().signal,
    ...(templateId === undefined ? {} : { templateId }),
  });

describe('SummaryService over the Markdown repository', () => {
  it('rewrites Summary and Action Items, keeps the other sections and the folder', async () => {
    const notified: string[] = [];
    const outcome = await generate(service(notified), WEEKLY, 'standup');
    expect(outcome).toMatchObject({ status: 'generated', titleChanged: false });
    expect(notified).toEqual([]);

    const files = fs.readdirSync(path.join(fx.root, 'Universidad', 'Cálculo'));
    expect(files).toEqual(['2026-09-01 Weekly sync planning.md']);
    const text = fs.readFileSync(path.join(fx.root, 'Universidad', 'Cálculo', files[0]!), 'utf8');
    expect(text).toContain('summaryProvider: codex');
    expect(text).toContain('noteTemplateId: standup');
    expect(text).toContain('## Summary\n\n### Fresh\nNew text');
    expect(text).toContain('- [ ] Call Ana');
    expect(text).not.toContain('Follow up with Luis');
    expect(text).toContain('## Brief\n\nTwo open questions.');
    expect(text).toContain('[00:00:03] Ana: Hello everyone.');
    expect(text).toContain('Remember the exam date.');
    expect(text).toContain('Subject: recap');
    expect(text).toContain('### Steps\nShip');

    const back = await fx.meetings.get(WEEKLY);
    expect(back).toMatchObject({
      folderId: '8e2f1b63-44d5-4a7c-9ba1-1d2e3f4a5b6c',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
      attendees: ['Ana Perez', 'Luis Gomez'],
    });
  });

  it('keeps Jev frontmatter, event keys and the Brief for a record that has them', async () => {
    const jev: JevAnalysis = {
      meetingType: 'planning',
      meetingTypeConfidence: 0.8,
      spokenLanguage: 'en',
      urgencyScore: 2,
      urgencyConfidence: 0.5,
      containsDecisions: 1,
      containsCommitments: 1,
      piiRisk: 0,
      summaryFaithful: 0.9,
      suggestedFolderId: null,
      folderConfidence: null,
      actionItems: [{ text: 'Old', relation: 'new', confidence: 0.4 }],
      model: 'jev-1',
      analyzedAt: '2026-09-01T14:00:00.0000000-05:00',
    };
    const base = (await fx.meetings.get(WEEKLY))!;
    const rich: MeetingRecord = {
      ...base,
      calendarEventId: 'evt-9',
      calendarId: 'cal-9',
      seriesId: 'series-9',
      jevAnalysis: jev,
      noteTemplateId: 'custom',
    };
    await fx.meetings.save(rich);
    const before = (await fx.meetings.get(WEEKLY))!;
    expect(before.jevAnalysis).toMatchObject({ meetingType: 'planning', model: 'jev-1' });

    await generate(service([]), WEEKLY);
    const after = (await fx.meetings.get(WEEKLY))!;
    expect(after).toEqual({
      ...before,
      summary: '### Fresh\nNew text',
      actionItems: [{ text: 'Call Ana', isDone: false }],
      summaryProvider: 'codex',
      noteTemplateId: null,
      sourcePath: after.sourcePath,
    });
    expect(after.calendarEventId).toBe('evt-9');
    expect(after.brief).toBe('Two open questions.');
  });
});
