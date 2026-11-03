import { describe, expect, it } from 'vitest';
import { CancelSource } from '../../cancel';
import type { JevAnalysis } from '../../library/meeting';
import { parseMeetingMarkdown, renderMeetingMarkdown } from '../../library/meeting-markdown';
import {
  FakePreviousAudioKeeper,
  RecordingHostSpy,
  ScriptedMeetingStore,
  TEST_MEETING_ID,
  TEST_RECORDED_AT_MS,
  createPipelineHarness,
  makeMeeting,
  makeRequest,
} from './pipeline-test-kit';

const OFFLINE = '[00:00.00-00:02.00] offline words';
const DRAFT = '[00:00.00-00:02.00] live words';

describe('first save', () => {
  it('saves a new take with a draft before the offline pass, with no summary', async () => {
    const h = createPipelineHarness({ transcriber: { result: OFFLINE } });
    const order: string[] = [];
    const save = h.store.save.bind(h.store);
    h.store.save = (r) => {
      order.push('save');
      return save(r);
    };
    const t = h.transcriber.transcribe.bind(h.transcriber);
    h.transcriber.transcribe = (r) => {
      order.push('transcribe');
      return t(r);
    };
    await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(order).toEqual(['save', 'transcribe', 'save']);
    expect(h.store.saves[0]?.transcript).toContain('live words');
    expect(h.store.saves[0]?.summary).toBeNull();
    expect(h.store.saves[0]?.actionItems).toEqual([]);
  });

  it('keeps the existing content when a new take has no draft', async () => {
    const store = new ScriptedMeetingStore();
    store.records.set(
      TEST_MEETING_ID,
      makeMeeting({
        audioFilePath: 'C:/lib/old.wav',
        transcript: 'old transcript',
        summary: 'old summary',
        actionItems: [{ text: 'a', isDone: false }],
        summaryProvider: 'Codex',
      }),
    );
    const h = createPipelineHarness({ store, transcriber: { result: OFFLINE } });
    await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(store.saves[0]?.transcript).toContain('old transcript');
    expect(store.saves[0]).toMatchObject({
      summary: 'old summary',
      summaryProvider: 'Codex',
      audioFilePath: 'C:/lib/standup.wav',
    });
  });

  it('does not save first when re-running over the audio the meeting already owns', async () => {
    const store = new ScriptedMeetingStore();
    store.records.set(TEST_MEETING_ID, makeMeeting({ transcript: 'old', summary: 'S' }));
    const h = createPipelineHarness({ store, transcriber: { result: OFFLINE } });
    await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(store.saves).toHaveLength(1);
  });

  it('B-7: keeps the previous summary and action items until the new summary succeeds', async () => {
    const store = new ScriptedMeetingStore();
    store.records.set(
      TEST_MEETING_ID,
      makeMeeting({
        transcript: 'old',
        summary: 'old summary',
        summaryProvider: 'Codex',
        actionItems: [{ text: 'do it', isDone: true }],
      }),
    );
    const h = createPipelineHarness({ store, transcriber: { result: OFFLINE } });
    await h.pipeline.run(makeRequest(), h.host, h.cancel);
    const saved = store.records.get(TEST_MEETING_ID);
    expect(saved?.transcript).toContain('offline words');
    expect(saved).toMatchObject({
      summary: 'old summary',
      summaryProvider: 'Codex',
      actionItems: [{ text: 'do it', isDone: true }],
    });
  });

  it('a new take writes no summary with the transcript (spec 140)', async () => {
    const h = createPipelineHarness({ transcriber: { result: OFFLINE } });
    const out = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(out.kind).toBe('transcript-saved');
    expect(h.store.saves.at(-1)).toMatchObject({
      summary: null,
      actionItems: [],
      summaryProvider: null,
    });
  });

  it('B-11: a failed first save with no draft returns a recoverable outcome and keeps the message', async () => {
    const store = new ScriptedMeetingStore();
    store.failSaves.add(1);
    const h = createPipelineHarness({ store });
    const out = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(out).toMatchObject({ kind: 'first-save-failed', audioPath: 'C:/lib/standup.wav' });
    expect(h.host.terminal).toEqual([
      { kind: 'finished', message: { key: 'Error_ProcessRecording', args: ['disk full'] } },
    ]);
    expect(h.transcriber.calls).toHaveLength(0);
    // The same audio can be run again once the store works.
    const again = await h.pipeline.run(makeRequest(), new RecordingHostSpy(), new CancelSource());
    expect(again.kind).toBe('transcript-saved');
  });

  it('a failed first save with a draft goes on and still saves the transcript later', async () => {
    const store = new ScriptedMeetingStore();
    store.failSaves.add(1);
    const h = createPipelineHarness({ store, transcriber: { result: OFFLINE } });
    const out = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(out.kind).toBe('transcript-saved');
    expect(store.records.get(TEST_MEETING_ID)?.transcript).toContain('offline words');
  });

  it('B-3: a take that replaces another WAV keeps the previous one', async () => {
    const store = new ScriptedMeetingStore();
    store.records.set(
      TEST_MEETING_ID,
      makeMeeting({ audioFilePath: 'C:/lib/first.wav', transcript: 't' }),
    );
    const h = createPipelineHarness({ store, transcriber: { result: OFFLINE } });
    const out = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(h.keeper?.kept).toEqual(['C:/lib/first.wav']);
    expect(out).toMatchObject({ previousAudioPath: 'C:/lib/first (previous).wav' });
  });

  it('B-3: without a keeper, or when it fails, the old path is reported and left alone', async () => {
    const store = new ScriptedMeetingStore();
    store.records.set(TEST_MEETING_ID, makeMeeting({ audioFilePath: 'C:/lib/first.wav' }));
    const failing = new FakePreviousAudioKeeper();
    failing.fail = true;
    const h = createPipelineHarness({ store, keeper: failing, transcriber: { result: OFFLINE } });
    const out = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(out).toMatchObject({ previousAudioPath: 'C:/lib/first.wav' });
    store.records.set(TEST_MEETING_ID, makeMeeting({ audioFilePath: 'C:/lib/first.wav' }));
    const none = createPipelineHarness({ store, keeper: null, transcriber: { result: OFFLINE } });
    expect(await none.pipeline.run(makeRequest(), none.host, none.cancel)).toMatchObject({
      previousAudioPath: 'C:/lib/first.wav',
    });
  });

  it('B-28: later saves use the audio path the repository returned', async () => {
    const store = new ScriptedMeetingStore();
    store.moveAudioTo = 'C:/lib/Folder/standup.wav';
    const h = createPipelineHarness({ store, transcriber: { result: OFFLINE } });
    const out = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(store.saves[0]?.audioFilePath).toBe('C:/lib/standup.wav');
    expect(store.saves[1]?.audioFilePath).toBe('C:/lib/Folder/standup.wav');
    expect(h.transcriber.calls[0]?.audioPath).toBe('C:/lib/Folder/standup.wav');
    expect(out).toMatchObject({ audioPath: 'C:/lib/Folder/standup.wav' });
  });
});

describe('offline pass', () => {
  it('reports progress as status messages and passes language, skew and diarization', async () => {
    const h = createPipelineHarness({
      settings: { transcriptionLanguage: null, speakerDiarizationEnabled: true },
      transcriber: { progress: [10, 55], result: OFFLINE },
    });
    await h.pipeline.run(makeRequest({ pausedDurationMs: 4000 }), h.host, h.cancel);
    const statuses = h.host.events.flatMap((e) => (e.kind === 'status' ? [e.message] : []));
    expect(statuses).toEqual([
      { key: 'Status_Transcribing', args: [] },
      { key: 'Status_TranscribingPercent', args: ['10'] },
      { key: 'Status_TranscribingPercent', args: ['55'] },
    ]);
    expect(h.transcriber.calls[0]).toMatchObject({
      language: 'es',
      clockSkewMs: 4000,
      speakerDiarization: true,
      recordedAtMs: TEST_RECORDED_AT_MS,
    });
  });

  it('replaces the draft with the offline transcript and refreshes the host', async () => {
    const h = createPipelineHarness({ transcriber: { result: OFFLINE } });
    const out = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(out.kind === 'transcript-saved' && out.transcript).toContain('offline words');
    expect(h.host.events.some((e) => e.kind === 'transcript')).toBe(true);
  });

  it('keeps the draft with a warning when the pass fails', async () => {
    const h = createPipelineHarness({ transcriber: { result: new Error('engine crashed') } });
    const out = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(out).toMatchObject({
      kind: 'transcript-saved',
      transcriptionWarning: {
        key: 'Status_LiveDraftKeptTranscriptionFailed',
        args: ['engine crashed'],
      },
    });
  });

  it('keeps the draft silently when the pass finds nothing', async () => {
    const h = createPipelineHarness({ transcriber: { result: '' } });
    const out = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(out).toMatchObject({ kind: 'transcript-saved', transcriptionWarning: null });
  });

  it('a failed pass without a draft reports the audio kept and stops', async () => {
    const h = createPipelineHarness({ transcriber: { result: new Error('boom') } });
    const out = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(out.kind).toBe('saved-without-transcript');
    expect(h.host.terminal).toEqual([
      {
        kind: 'savedWithoutTranscript',
        meetingId: TEST_MEETING_ID,
        message: { key: 'Error_TranscriptionFailedAudioKept', args: ['boom'] },
      },
    ]);
    expect(h.store.saves).toHaveLength(1);
  });

  it('an empty pass without a draft reports no transcript', async () => {
    const h = createPipelineHarness({ transcriber: { result: '  ' } });
    await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(h.host.terminal).toMatchObject([
      { kind: 'savedWithoutTranscript', message: { key: 'Error_NoTranscript' } },
    ]);
  });

  it('B-18: engine not ready without a draft uses the accurate message', async () => {
    const h = createPipelineHarness({ transcriber: { ready: false } });
    const out = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(out.kind).toBe('saved-without-transcript');
    expect(h.host.terminal).toMatchObject([
      { kind: 'savedWithoutTranscript', message: { key: 'Ui_TranscriptionEngineUnavailable' } },
    ]);
    expect(h.transcriber.calls).toHaveLength(0);
  });

  it('engine not ready with a draft continues with the draft', async () => {
    const h = createPipelineHarness({ transcriber: { ready: false } });
    const out = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(out.kind).toBe('transcript-saved');
    expect(h.host.terminal).toEqual([]);
  });
});

describe('cancellation', () => {
  it('during the pass with a draft saves the draft and says so', async () => {
    const cancel = new CancelSource();
    const h = createPipelineHarness({ transcriber: { cancelDuring: cancel } });
    const out = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, cancel);
    expect(out).toMatchObject({ kind: 'cancelled', transcriptSaved: true });
    expect(h.host.terminal).toEqual([
      { kind: 'titleResetFinished', message: { key: 'Status_CancelledTranscriptSaved', args: [] } },
    ]);
    expect(h.store.records.get(TEST_MEETING_ID)?.transcript).toContain('live words');
  });

  it('during the pass with no draft is a durable save without transcript', async () => {
    const cancel = new CancelSource();
    const h = createPipelineHarness({ transcriber: { cancelDuring: cancel } });
    const out = await h.pipeline.run(makeRequest(), h.host, cancel);
    expect(out).toMatchObject({ kind: 'cancelled', transcriptSaved: false });
    expect(h.host.terminal).toMatchObject([
      { kind: 'savedWithoutTranscript', message: { key: 'Status_ProcessingCancelled' } },
    ]);
  });

  it('with no draft and no durable meeting just finishes', async () => {
    const store = new ScriptedMeetingStore();
    store.failSaves.add(1);
    const cancel = new CancelSource();
    const h = createPipelineHarness({ store, transcriber: { cancelDuring: cancel } });
    // Existing meeting owns the audio, so no first save runs and nothing is durable yet.
    store.records.set(TEST_MEETING_ID, makeMeeting());
    const out = await h.pipeline.run(makeRequest(), h.host, cancel);
    expect(out).toMatchObject({ kind: 'cancelled', transcriptSaved: false });
    expect(h.host.terminal).toEqual([
      { kind: 'finished', message: { key: 'Status_ProcessingCancelled', args: [] } },
    ]);
  });

  it('after the pass but before the transcript save keeps the transcript it has', async () => {
    const cancel = new CancelSource();
    const h = createPipelineHarness({ transcriber: { result: OFFLINE } });
    const original = h.transcriber.transcribe.bind(h.transcriber);
    h.transcriber.transcribe = async (r) => {
      const text = await original(r);
      cancel.cancel();
      return text;
    };
    const out = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, cancel);
    expect(out).toMatchObject({ kind: 'cancelled', transcriptSaved: true });
    expect(h.store.records.get(TEST_MEETING_ID)?.transcript).toContain('offline words');
  });

  it('a failing save while cancelled is a terminal error, never a stuck run', async () => {
    const store = new ScriptedMeetingStore();
    store.failSaves.add(2);
    const cancel = new CancelSource();
    const h = createPipelineHarness({ store, transcriber: { cancelDuring: cancel } });
    const out = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, cancel);
    expect(out).toMatchObject({ kind: 'cancelled', transcriptSaved: false });
    expect(h.host.terminal).toEqual([
      { kind: 'finished', message: { key: 'Error_ProcessRecording', args: ['disk full'] } },
    ]);
  });
});

describe('saved record', () => {
  const jev: JevAnalysis = {
    meetingType: 'standup',
    meetingTypeConfidence: 0.9,
    spokenLanguage: 'en',
    urgencyScore: 2,
    urgencyConfidence: null,
    containsDecisions: 1,
    containsCommitments: 0,
    piiRisk: 0,
    summaryFaithful: null,
    suggestedFolderId: null,
    folderConfidence: null,
    actionItems: [],
    model: 'm',
    analyzedAt: '2026-09-01T12:40:00+00:00',
  };

  it('B-6: carries over Jev, notes, attendees, calendar ids, template, follow-up and plan', async () => {
    const store = new ScriptedMeetingStore();
    store.records.set(
      TEST_MEETING_ID,
      makeMeeting({
        jevAnalysis: jev,
        notes: 'my notes',
        attendees: ['ana', 'luis'],
        calendarEventId: 'ev1',
        calendarId: 'cal1',
        seriesId: 's1',
        joinUrl: 'https://x',
        noteTemplateId: 'tpl',
        brief: 'the brief',
        followUp: 'f',
        projectPlan: 'p',
      }),
    );
    const h = createPipelineHarness({ store, transcriber: { result: OFFLINE } });
    await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(store.records.get(TEST_MEETING_ID)).toMatchObject({
      jevAnalysis: jev,
      notes: 'my notes',
      attendees: ['ana', 'luis'],
      calendarEventId: 'ev1',
      calendarId: 'cal1',
      seriesId: 's1',
      joinUrl: 'https://x',
      noteTemplateId: 'tpl',
      brief: 'the brief',
      followUp: 'f',
      projectPlan: 'p',
    });
  });

  it('trims request values, nulls blanks and prefers the request over the stored record', async () => {
    const store = new ScriptedMeetingStore();
    store.records.set(TEST_MEETING_ID, makeMeeting({ brief: 'old brief', calendarId: 'old' }));
    const h = createPipelineHarness({ store, transcriber: { result: OFFLINE } });
    h.host.currentSessionNotes = '  fresh notes \n';
    await h.pipeline.run(
      makeRequest({
        calendarEventId: '  ev2 ',
        calendarId: '   ',
        brief: ' new brief ',
        attendees: [' ana ', '', '  '],
        noteTemplateId: ' t ',
      }),
      h.host,
      h.cancel,
    );
    expect(store.records.get(TEST_MEETING_ID)).toMatchObject({
      calendarEventId: 'ev2',
      calendarId: 'old',
      brief: 'new brief',
      attendees: ['ana'],
      noteTemplateId: 't',
      notes: 'fresh notes',
    });
  });

  it('stamps the Recorded and Ended header and stars the highlights once, at every save', async () => {
    const h = createPipelineHarness({
      transcriber: { result: '[00:00.00-00:05.00] a\n[00:05.00-00:10.00] b' },
    });
    await h.pipeline.run(makeRequest({ highlightsMs: [6000] }), h.host, h.cancel);
    for (const save of h.store.saves.filter((s) => s.transcript !== null)) {
      const lines = (save.transcript ?? '').split('\n');
      expect(lines[0]).toMatch(/^Recorded \d{4}-/);
      expect(lines[1]).toMatch(/^Ended \d{4}-/);
      expect(lines.filter((l) => l.startsWith('* ')).length).toBe(1);
    }
    expect(h.store.saves.at(-1)?.transcript).toContain('* [00:05.00-00:10.00] b');
  });

  it('writes a null end when the end is unknown', async () => {
    const h = createPipelineHarness({ transcriber: { result: OFFLINE } });
    await h.pipeline.run(makeRequest({ endedAtMs: null }), h.host, h.cancel);
    expect(h.store.saves.at(-1)?.endedAt).toBeNull();
    expect(h.store.saves.at(-1)?.transcript).not.toMatch(/^Ended/m);
  });

  it('round trips through the real Markdown formatter and parser', async () => {
    const store = new ScriptedMeetingStore();
    store.records.set(
      TEST_MEETING_ID,
      makeMeeting({
        jevAnalysis: jev,
        brief: 'brief text',
        notes: 'n',
        attendees: ['ana'],
        calendarEventId: 'e',
      }),
    );
    const h = createPipelineHarness({ store, transcriber: { result: OFFLINE } });
    h.host.currentSessionNotes = 'session notes';
    await h.pipeline.run(
      makeRequest({ title: 'Round trip', highlightsMs: [1000] }),
      h.host,
      h.cancel,
    );
    const saved = store.records.get(TEST_MEETING_ID);
    if (saved === undefined) throw new Error('not saved');
    const text = renderMeetingMarkdown(saved);
    const reread = parseMeetingMarkdown('C:/lib/standup.md', text, { fileExists: () => true });
    expect(reread).toMatchObject({
      id: saved.id,
      title: 'Round trip',
      brief: 'brief text',
      notes: 'session notes',
      attendees: ['ana'],
      calendarEventId: 'e',
      jevAnalysis: jev,
      recordedAt: saved.recordedAt,
      endedAt: saved.endedAt,
      transcript: saved.transcript,
    });
    expect(reread.transcript).toContain('Ended ');
    expect(reread.transcript).toContain('* [00:00.00-00:02.00] offline words');
  });
});
