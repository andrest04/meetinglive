import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SummaryTabService, type MeetingRecord } from '@vozella/core';
import { createLibraryFixture, type LibraryFixture } from '../library/library-test-kit';

/** S14: tab patches on files written by the WinUI app keep every other field (items 98, 102). */
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

describe('SummaryTabService over the Markdown repository', () => {
  it('notes and action item toggles keep the Brief, event keys and the other sections', async () => {
    const service = new SummaryTabService({
      meetings: fx.meetings,
      translate: (key) => key,
      getSelectedMeetingId: () => null,
      selectMeeting: () => undefined,
    });
    const base = (await fx.meetings.get(WEEKLY))!;
    const withItems: MeetingRecord = {
      ...base,
      calendarEventId: 'evt-9',
      seriesId: 'series-9',
      actionItems: [
        { text: 'First', isDone: false },
        { text: 'Second', isDone: false },
      ],
    };
    await fx.meetings.save(withItems);

    await Promise.all([
      service.toggleActionItem(WEEKLY, 0, true),
      service.toggleActionItem(WEEKLY, 1, true),
      service.toggleActionItem(WEEKLY, 1, false),
      service.saveNotes(WEEKLY, 'Fresh notes'),
    ]);

    const back = (await fx.meetings.get(WEEKLY))!;
    expect(back.actionItems).toEqual([
      { text: 'First', isDone: true },
      { text: 'Second', isDone: false },
    ]);
    expect(back).toMatchObject({
      notes: 'Fresh notes',
      brief: base.brief,
      transcript: base.transcript,
      followUp: base.followUp,
      projectPlan: base.projectPlan,
      calendarEventId: 'evt-9',
      seriesId: 'series-9',
      folderId: base.folderId,
      joinUrl: base.joinUrl,
      attendees: base.attendees,
    });
    expect(base.brief).not.toBeNull();
  });
});
