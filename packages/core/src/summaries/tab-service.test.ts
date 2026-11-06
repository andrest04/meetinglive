import { describe, expect, it } from 'vitest';
import type { TranslateFn } from '../i18n/translator';
import { InMemoryMeetingRepository } from '../library/in-memory-library';
import type { MeetingRecord } from '../library/meeting';
import type { MeetingList } from '../library/ports';
import { copyTextFor, SummaryTabService } from './tab-service';

const strings: Record<string, string> = {
  NoSummariesYet: 'No summaries yet',
  SummaryPage_NoActionItems: 'No action items to copy.',
  Error_SaveActionItem: 'Error saving the action item: {0}',
};
const translate: TranslateFn = (key, ...args) =>
  (strings[key] ?? key).replace('{0}', String(args[0] ?? ''));

const rec = (id: string, patch: Partial<MeetingRecord> = {}): MeetingRecord => ({
  id,
  title: `Meeting ${id}`,
  recordedAt: '2026-09-01T12:00:00.0000000+00:00',
  endedAt: null,
  audioFilePath: '',
  sourcePath: null,
  folderId: 'folder-1',
  summaryProvider: 'codex',
  calendarEventId: 'evt-1',
  calendarId: 'cal-1',
  seriesId: null,
  joinUrl: 'https://meet.example/x',
  noteTemplateId: null,
  attendees: ['Ana'],
  brief: 'Brief text',
  transcript: 'Ana: hi',
  summary: '### Summary\nTalked.',
  actionItems: [],
  jevAnalysis: null,
  notes: null,
  followUp: 'follow',
  projectPlan: 'plan',
  ...patch,
});

function setup(records: MeetingRecord[], selected: string | null = null) {
  const repo = new InMemoryMeetingRepository();
  for (const r of records) repo.records.set(r.id, r);
  const selections: string[] = [];
  const service = new SummaryTabService({
    meetings: repo,
    translate,
    getSelectedMeetingId: () => selected,
    selectMeeting: (id) => selections.push(id),
  });
  return { repo, service, selections };
}

async function load(service: SummaryTabService, meetingId: string | null) {
  const result = await service.loadTab({ meetingId });
  if (result.status !== 'loaded') throw new Error('load failed');
  return result.state;
}

describe('loadTab resolution (items 78 to 80)', () => {
  const a = rec('a', { recordedAt: '2026-09-01T12:00:00.0000000+00:00' });
  const b = rec('b', { recordedAt: '2026-09-03T12:00:00.0000000+00:00' });
  const c = rec('c', { recordedAt: '2026-09-02T12:00:00.0000000+00:00' });

  it('prefers the given id', async () => {
    const { service, selections } = setup([a, b, c], 'c');
    const state = await load(service, 'a');
    expect(state.meetingId).toBe('a');
    expect(selections).toEqual(['a']);
  });

  it('falls back to the workspace selection', async () => {
    const { service } = setup([a, b, c], 'c');
    expect((await load(service, null)).meetingId).toBe('c');
  });

  it('falls back to the most recent recordedAt', async () => {
    const { service, selections } = setup([a, b, c]);
    expect((await load(service, null)).meetingId).toBe('b');
    expect(selections).toEqual(['b']);
  });

  it('no meetings gives the "No summaries yet" title and no selection', async () => {
    const { service, selections } = setup([]);
    const state = await load(service, null);
    expect(state).toMatchObject({
      hasMeeting: false,
      meetingId: null,
      title: 'No summaries yet',
      notes: '',
      summary: '',
      noteTemplateId: 'auto',
    });
    expect(state.flags.isEmpty).toBe(true);
    expect(selections).toEqual([]);
  });

  it('an unknown id has no meeting and selects nothing', async () => {
    const { service, selections } = setup([a]);
    expect((await load(service, 'zzz')).hasMeeting).toBe(false);
    expect(selections).toEqual([]);
  });

  it('fills the state from the record', async () => {
    const full = rec('f', {
      notes: 'my notes',
      noteTemplateId: 'standup',
      actionItems: [{ text: 'Call', isDone: true }],
    });
    const state = await load(setup([full]).service, 'f');
    expect(state).toMatchObject({
      title: 'Meeting f',
      notes: 'my notes',
      summary: '### Summary\nTalked.',
      noteTemplateId: 'standup',
      actionItems: [{ text: 'Call', isDone: true }],
      hasTranscript: true,
    });
    expect(state.templates.map((t) => t.id)).toEqual([
      'auto',
      'one-on-one',
      'standup',
      'sales',
      'user-interview',
    ]);
    expect(state.flags).toMatchObject({ canRegenerate: true, showDraftActions: true });
  });

  it('a blank template id loads as auto', async () => {
    const state = await load(setup([rec('x', { noteTemplateId: '  ' })]).service, 'x');
    expect(state.noteTemplateId).toBe('auto');
  });

  it('flags: transcript only can generate; summary only hides the bar', async () => {
    const { service } = setup([
      rec('t', { summary: null }),
      rec('s', { transcript: null }),
      rec('n', { summary: null, transcript: null }),
    ]);
    expect((await load(service, 't')).flags).toMatchObject({
      canGenerate: true,
      showSummaryActionBar: true,
    });
    expect((await load(service, 's')).flags).toMatchObject({
      hasSummary: true,
      canRegenerate: false,
      showSummaryActionBar: false,
    });
    expect((await load(service, 'n')).flags.isEmpty).toBe(true);
  });

  it('answers a failed read as a value', async () => {
    const { service, repo } = setup([a]);
    repo.get = () => Promise.reject(new Error('EBUSY'));
    expect(await service.loadTab({ meetingId: 'a' })).toEqual({
      status: 'failed',
      detail: 'EBUSY',
    });
  });
});

describe('related meetings in the tab (item 103)', () => {
  it('matches by title and by a series id read from the files, newest first, max 5', async () => {
    const cur = rec('cur', {
      title: 'Weekly',
      seriesId: 'S',
      recordedAt: '2026-09-30T00:00:00.0000000+00:00',
    });
    const titled = Array.from({ length: 4 }, (_, i) =>
      rec(`t${i}`, { title: 'Weekly', recordedAt: `2026-09-0${i + 1}T00:00:00.0000000+00:00` }),
    );
    const bySeries = rec('s1', {
      title: 'Renamed',
      seriesId: 'S',
      recordedAt: '2026-09-20T00:00:00.0000000+00:00',
    });
    const otherSeries = rec('s2', { title: 'Nope', seriesId: 'Z' });
    const bySeriesOld = rec('s3', {
      title: 'Old name',
      seriesId: 'S',
      recordedAt: '2026-08-01T00:00:00.0000000+00:00',
    });
    const { service } = setup([cur, ...titled, bySeries, otherSeries, bySeriesOld]);
    const state = await load(service, 'cur');
    expect(state.related.map((r) => r.id)).toEqual(['s1', 't3', 't2', 't1', 't0']);
  });

  it('without a series id it matches by title only and reads no other record', async () => {
    const cur = rec('cur', { title: 'Weekly' });
    const { service, repo } = setup([cur, rec('o', { title: 'Weekly', seriesId: 'S' })]);
    const original = repo.get.bind(repo);
    const reads: string[] = [];
    repo.get = (id) => {
      reads.push(id);
      return original(id);
    };
    expect((await load(service, 'cur')).related.map((r) => r.id)).toEqual(['o']);
    expect(reads).toEqual(['cur']);
  });

  it('a list failure leaves the tab loaded with no related meetings', async () => {
    const { service, repo } = setup([rec('cur')]);
    repo.list = (): Promise<MeetingList> => Promise.reject(new Error('boom'));
    expect((await load(service, 'cur')).related).toEqual([]);
  });
});

describe('saveNotes (item 102)', () => {
  it('writes changed notes on a freshly read record and keeps every other field', async () => {
    const { service, repo } = setup([rec('a')]);
    // The page copy is stale: the stored record got a new summary after the page loaded.
    repo.records.set('a', rec('a', { summary: 'newer summary', folderId: 'moved' }));
    expect(await service.saveNotes('a', 'hello')).toEqual({ status: 'saved' });
    expect(repo.records.get('a')).toEqual(
      rec('a', { summary: 'newer summary', folderId: 'moved', notes: 'hello' }),
    );
  });

  it('skips the write when the value equals the stored one', async () => {
    const { service, repo } = setup([rec('a', { notes: 'same' })]);
    let saves = 0;
    const save = repo.save.bind(repo);
    repo.save = (r) => {
      saves += 1;
      return save(r);
    };
    expect(await service.saveNotes('a', 'same')).toEqual({ status: 'unchanged' });
    expect(saves).toBe(0);
  });

  it('blank text is stored as null, and blank over null is unchanged', async () => {
    const { service, repo } = setup([rec('a', { notes: 'x' }), rec('b')]);
    expect(await service.saveNotes('a', '  \n')).toEqual({ status: 'saved' });
    expect(repo.records.get('a')?.notes).toBeNull();
    expect(await service.saveNotes('b', '')).toEqual({ status: 'unchanged' });
  });

  it('answers not-found and failed as values', async () => {
    const { service, repo } = setup([rec('a')]);
    expect(await service.saveNotes('zzz', 'x')).toEqual({ status: 'not-found' });
    repo.save = () => Promise.reject(new Error('disk full'));
    expect(await service.saveNotes('a', 'x')).toEqual({ status: 'failed', detail: 'disk full' });
  });
});

describe('toggleActionItem (item 98, B5)', () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ text: `Task ${i}`, isDone: false }));

  it('persists the toggle and returns the saved list; other fields stay', async () => {
    const { service, repo } = setup([rec('a', { actionItems: items })]);
    const result = await service.toggleActionItem('a', 1, true);
    expect(result).toEqual({
      status: 'saved',
      actionItems: [items[0], { text: 'Task 1', isDone: true }, items[2]],
    });
    expect(repo.records.get('a')).toMatchObject({ brief: 'Brief text', calendarEventId: 'evt-1' });
  });

  it('20 rapid toggles on slow saves land in order and the last value persists', async () => {
    const { service, repo } = setup([rec('a', { actionItems: items })]);
    const written: boolean[] = [];
    const save = repo.save.bind(repo);
    let calls = 0;
    repo.save = async (r) => {
      // Earlier saves are slower; unordered writes would let an old value win.
      for (let i = 0; i < 20 - calls; i += 1) await Promise.resolve();
      calls += 1;
      written.push(r.actionItems[0]?.isDone ?? false);
      return save(r);
    };
    const pending = Array.from({ length: 20 }, (_, i) =>
      service.toggleActionItem('a', 0, i % 2 === 0),
    );
    const results = await Promise.all(pending);
    expect(results.every((r) => r.status === 'saved')).toBe(true);
    expect(written).toEqual(Array.from({ length: 20 }, (_, i) => i % 2 === 0));
    expect(repo.records.get('a')?.actionItems[0]?.isDone).toBe(false);
  });

  it('a failing save rejects only that toggle; the next still runs', async () => {
    const { service, repo } = setup([rec('a', { actionItems: items })]);
    const save = repo.save.bind(repo);
    let call = 0;
    repo.save = (r) => {
      call += 1;
      return call === 2 ? Promise.reject(new Error('locked')) : save(r);
    };
    const [one, two, three] = await Promise.all([
      service.toggleActionItem('a', 0, true),
      service.toggleActionItem('a', 1, true),
      service.toggleActionItem('a', 2, true),
    ]);
    expect(one.status).toBe('saved');
    expect(two).toEqual({
      status: 'failed',
      message: 'Error saving the action item: locked',
      detail: 'locked',
    });
    expect(three.status).toBe('saved');
    expect(repo.records.get('a')?.actionItems.map((i) => i.isDone)).toEqual([true, false, true]);
  });

  it('answers not-found and out-of-range as values', async () => {
    const { service } = setup([rec('a', { actionItems: items })]);
    expect(await service.toggleActionItem('zzz', 0, true)).toEqual({ status: 'not-found' });
    expect(await service.toggleActionItem('a', 3, true)).toEqual({ status: 'out-of-range' });
    expect(await service.toggleActionItem('a', -1, true)).toEqual({ status: 'out-of-range' });
  });
});

describe('copy (items 99 and 104)', () => {
  it('no action items is empty with the message', async () => {
    const { service } = setup([rec('a')]);
    expect(await service.copyActionItems('a')).toEqual({
      status: 'empty',
      message: 'No action items to copy.',
    });
  });

  it('renders the lines without the trailing newline', async () => {
    const { service } = setup([
      rec('a', {
        actionItems: [
          { text: 'One', isDone: false },
          { text: 'Two', isDone: true },
        ],
      }),
    ]);
    expect(await service.copyActionItems('a')).toEqual({
      status: 'copied',
      text: '- [ ] One\n- [x] Two',
    });
    expect(await service.copyActionItems('zzz')).toEqual({ status: 'not-found' });
  });

  it('copyText returns notes or summary, null when blank', async () => {
    const { service } = setup([rec('a', { notes: 'n' }), rec('b', { summary: '  ' })]);
    expect(await service.copyText('a', 'notes')).toBe('n');
    expect(await service.copyText('a', 'summary')).toBe('### Summary\nTalked.');
    expect(await service.copyText('b', 'summary')).toBeNull();
    expect(await service.copyText('b', 'notes')).toBeNull();
    expect(copyTextFor('notes', { notes: ' ', summary: 'x' })).toBeNull();
    expect(copyTextFor('summary', { notes: null, summary: 'x' })).toBe('x');
  });
});

describe('setTemplate (S15)', () => {
  it('stores a built-in id, clears it for auto, and skips an unchanged write', async () => {
    const { repo, service } = setup([rec('a')]);
    expect(await service.setTemplate('a', 'standup')).toEqual({ status: 'saved' });
    expect(repo.records.get('a')?.noteTemplateId).toBe('standup');
    expect(await service.setTemplate('a', 'standup')).toEqual({ status: 'unchanged' });
    expect(await service.setTemplate('a', 'auto')).toEqual({ status: 'saved' });
    expect(repo.records.get('a')?.noteTemplateId).toBeNull();
    expect(await service.setTemplate('zzz', 'sales')).toEqual({ status: 'not-found' });
  });
});

describe('replaceSummary (T4: apply a chat answer, undo)', () => {
  const items = [{ text: 'Ana sends the deck', isDone: true }];

  it('an answer replaces the summary, keeps the action items and returns the previous content', async () => {
    const { repo, service } = setup([rec('a', { actionItems: items, summaryProvider: 'codex' })]);
    const result = await service.replaceSummary('a', { kind: 'answer', text: 'New **text**.' });
    expect(result).toEqual({
      status: 'saved',
      previous: { summary: '### Summary\nTalked.', actionItems: items },
    });
    expect(repo.records.get('a')).toMatchObject({
      summary: 'New **text**.',
      actionItems: items,
      summaryProvider: 'codex',
      brief: 'Brief text',
      notes: null,
    });
  });

  it('a summary-shaped answer replaces the action items too', async () => {
    const { repo, service } = setup([rec('a', { actionItems: items })]);
    await service.replaceSummary('a', {
      kind: 'answer',
      text: '## Summary\nShort.\n## Action Items\n- [ ] Luis books the room',
    });
    expect(repo.records.get('a')).toMatchObject({
      summary: 'Short.',
      actionItems: [{ text: 'Luis books the room', isDone: false }],
    });
  });

  it('restore puts the previous summary and action items back exactly', async () => {
    const { repo, service } = setup([rec('a', { actionItems: items })]);
    const applied = await service.replaceSummary('a', {
      kind: 'answer',
      text: '## Summary\nX\n## Action Items\n- [ ] Y',
    });
    if (applied.status !== 'saved') throw new Error('not saved');
    const undone = await service.replaceSummary('a', { kind: 'restore', ...applied.previous });
    expect(undone.status).toBe('saved');
    expect(repo.records.get('a')).toMatchObject({
      summary: '### Summary\nTalked.',
      actionItems: items,
    });
  });

  it('restore of a meeting that had no summary writes null back', async () => {
    const { repo, service } = setup([rec('a', { summary: null })]);
    const applied = await service.replaceSummary('a', { kind: 'answer', text: 'Now one.' });
    if (applied.status !== 'saved') throw new Error('not saved');
    expect(applied.previous.summary).toBeNull();
    await service.replaceSummary('a', { kind: 'restore', ...applied.previous });
    expect(repo.records.get('a')?.summary).toBeNull();
  });

  it('a blank answer, a missing meeting and a failing save answer values', async () => {
    const { repo, service } = setup([rec('a')]);
    expect(await service.replaceSummary('a', { kind: 'answer', text: '  ' })).toEqual({
      status: 'empty',
    });
    expect(await service.replaceSummary('zzz', { kind: 'answer', text: 'x' })).toEqual({
      status: 'not-found',
    });
    repo.save = () => Promise.reject(new Error('locked'));
    expect(await service.replaceSummary('a', { kind: 'answer', text: 'x' })).toEqual({
      status: 'failed',
      detail: 'locked',
    });
  });
});
