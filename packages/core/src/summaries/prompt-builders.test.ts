import { describe, expect, it } from 'vitest';
import { offsetDateFromInstant, parseOffsetDate } from '../library/offset-date';
import { SUMMARY_LANGUAGES } from '../settings/languages';
import {
  SUMMARY_HEADINGS,
  buildMergePrompt,
  buildPartPrompt,
  buildSummaryPrompt,
  createEnhancementContext,
  toEnglishLanguageName,
} from './prompt-builders';

const at = (text: string) => {
  const parsed = parseOffsetDate(text);
  if (!parsed) throw new Error(text);
  return parsed;
};
const recordedAt = at('2026-11-02T14:00:00.0000000-05:00');
const endedAt = at('2026-11-02T15:30:00.0000000-05:00');

const base = (over: Partial<Parameters<typeof buildSummaryPrompt>[0]> = {}) =>
  buildSummaryPrompt({
    title: 'Weekly sync',
    recordedAt,
    transcript: 'hello there',
    outputLanguage: 'en',
    endedAt: null,
    enhancement: null,
    ...over,
  });

const SUMMARY_EN = `# Identity

You extract meeting and lecture notes from an automatic-speech-recognition transcript.
The transcript may contain ASR errors, false starts, and filler. You are a note-taker,
not a novelist.

# Instructions

Respond with exactly three Markdown sections, in this order, and nothing else
(no preamble, no code fences, no closing commentary):

## Title

One short title, about 3–8 words. No quotes, no trailing period, no markdown.
Write the title in English. If the recording is an informal ASR test, say so
plainly (e.g. "Microphone test"). Do not copy <meeting_title> unless it already
describes the content. Ground it in the transcript; do not invent.

## Summary

Use these subheadings inside the Summary body, verbatim (omit a subheading if that
content is not in the transcript):

### What this was
One or two sentences: meeting, class, informal test, or unclear.

### Key points
Bullet list of substantive points actually said.

### Decisions
Bullet list of decisions that were explicitly made. If none, omit this subheading.

### Open questions
Unresolved questions or disagreements. If none, omit this subheading.

## Action Items

Each follow-up as a Markdown checkbox. Include owner and due date only when the
transcript states them. If priority was stated, append it. Examples:
- [ ] Send the revised deck — Owner: Ana — Due: Friday
- [ ] Review the API contract

If there are no action items, leave this section empty (keep the heading).

Rules:
- Ground every sentence in the transcript. Do not invent attendees, dates, companies, or tasks.
- If the recording is an informal ASR test or rambling, say so in "What this was". Do not dress it up as a formal meeting.
- If a name or number is unclear because of ASR noise, paraphrase without guessing the spelling.
- Transcript lines are stamped [mm:ss.ff-mm:ss.ff] elapsed ranges from recording start, with optional [ Speaker-N ] labels. When placing a key point, decision, or quote in time, use that elapsed range (and Recorded/Ended for wall-clock meeting bounds).
- Transcript may start with Recorded and Ended local stamps (yyyy-MM-dd HH:mm). Use those / <ended_at> as the meeting end. Never write that the end time was not recorded when Ended or <ended_at> is present. If missing, omit end time (do not invent, do not say "not recorded").
- Write the Title, the Summary body, and action-item text in English.
- Use the ### subheadings above verbatim — do not translate them.
- Keep the Markdown headings exactly "## Title", "## Summary", and "## Action Items" in English.

# Context

<meeting_title>Weekly sync</meeting_title>
<recorded_at>2026-11-02T14:00:00.0000000-05:00</recorded_at>
<transcript>
hello there
</transcript>`;

describe('buildSummaryPrompt snapshot', () => {
  it('matches spec 3.1 for English with no end time', () => {
    expect(base()).toBe(SUMMARY_EN);
  });

  it('uses Spanish subheadings and examples for Spanish, and keeps the language name in the rules', () => {
    const text = base({ outputLanguage: 'es' });
    expect(text).toContain('### Qué fue esto\nOne or two sentences');
    expect(text).toContain('### Puntos clave\n');
    expect(text).toContain('### Decisiones\n');
    expect(text).toContain('### Preguntas abiertas\n');
    expect(text).toContain(
      '- [ ] Enviar el deck revisado — Owner: Ana — Due: viernes\n- [ ] Revisar el contrato de la API',
    );
    expect(text).toContain('Write the title in Spanish.');
    expect(text).toContain('say so in "Qué fue esto".');
  });

  it('contains the U+2013 dash in 3-8 and no ASCII variant', () => {
    expect(base()).toContain('about 3–8 words');
    expect(base()).not.toContain('3-8 words');
  });

  it('uses LF only', () => {
    const text = base({ endedAt, enhancement: createEnhancementContext({ rawNotes: 'a\r\nb' }) });
    expect(text).not.toContain('\r');
    expect(text).toContain('<raw_notes>\na\nb\n</raw_notes>');
  });
});

describe('language mapping', () => {
  it.each([
    [null, 'Spanish'],
    [undefined, 'Spanish'],
    ['', 'Spanish'],
    ['  ', 'Spanish'],
    ['xx', 'Spanish'],
    ['es', 'Spanish'],
    ['en', 'English'],
    [' EN ', 'English'],
    ['pt', 'Portuguese'],
    ['fr', 'French'],
    ['de', 'German'],
    ['it', 'Italian'],
    ['nl', 'Dutch'],
    ['ja', 'Japanese'],
    ['zh', 'Chinese'],
  ])('%j maps to %s', (code, name) => {
    expect(toEnglishLanguageName(code)).toBe(name);
  });

  it('English headings only for a trimmed, case-insensitive en', () => {
    expect(base({ outputLanguage: '  En ' })).toContain('### What this was');
    expect(base({ outputLanguage: 'fr' })).toContain('### Qué fue esto');
    expect(base({ outputLanguage: 'fr' })).toContain('Write the title in French.');
    expect(base({ outputLanguage: null })).toContain('### Qué fue esto');
  });

  it('B27: every code the Settings picker offers has matching headings', () => {
    for (const { code } of SUMMARY_LANGUAGES) {
      const headings = SUMMARY_HEADINGS[code];
      expect(headings, code).toBeDefined();
      const text = base({ outputLanguage: code });
      expect(text).toContain(`### ${headings!.whatThisWas}\n`);
      expect(text).toContain(`### ${headings!.keyPoints}\n`);
      expect(text).toContain(`### ${headings!.decisions}\n`);
      expect(text).toContain(`### ${headings!.openQuestions}\n`);
    }
  });

  it('B27: only es and en are populated, other codes fall back to Spanish', () => {
    expect(Object.keys(SUMMARY_HEADINGS).sort()).toEqual(['en', 'es']);
  });
});

describe('dates', () => {
  it('writes recorded_at in round-trip form with seven digits and offset', () => {
    const instant = offsetDateFromInstant(new Date(Date.UTC(2026, 10, 2, 19, 0, 0, 120)), -300);
    expect(base({ recordedAt: instant })).toContain(
      '<recorded_at>2026-11-02T14:00:00.1200000-05:00</recorded_at>',
    );
  });

  it('emits ended_at after recorded_at when set, with the never-say-not-recorded rule', () => {
    const text = base({ endedAt });
    expect(text).toContain(
      '<recorded_at>2026-11-02T14:00:00.0000000-05:00</recorded_at>\n<ended_at>2026-11-02T15:30:00.0000000-05:00</ended_at>\n<transcript>',
    );
    expect(text).toContain('Never write that the end time was not recorded');
  });

  it('omits the ended_at tag when no end time is given', () => {
    expect(base()).not.toContain('</ended_at>');
  });
});

describe('enhancement', () => {
  it('adds nothing when the context has nothing', () => {
    const none = createEnhancementContext({
      rawNotes: ' ',
      attendees: [' ', ''],
      agenda: '',
      templateInstructions: null,
    });
    expect(none.hasAny).toBe(false);
    expect(base({ enhancement: none })).toBe(SUMMARY_EN);
    expect(base({ enhancement: null })).toBe(SUMMARY_EN);
  });

  it('computes the flags', () => {
    const ctx = createEnhancementContext({ attendees: ['', ' Ana '], agenda: 'x' });
    expect(ctx).toMatchObject({
      hasRawNotes: false,
      hasAttendees: true,
      hasAgenda: true,
      hasTemplateInstructions: false,
      hasAny: true,
    });
  });

  it('appends the rules and the raw notes block with the output contract intact', () => {
    const text = base({ enhancement: createEnhancementContext({ rawNotes: '  call Ana  ' }) });
    expect(text).toBe(
      `${SUMMARY_EN}\nExtra rules for the supplied context:
- Do not invent attendees, dates, quotes, or tasks that are not in the transcript or the supplied context.
- Still emit exactly "## Title", "## Summary", and "## Action Items" in that order, and nothing else.
- Treat the raw notes as important. Include those points. Fix typos. Fill structure from the transcript.
<raw_notes>
call Ana
</raw_notes>
`,
    );
    expect(text).toContain(
      'Keep the Markdown headings exactly "## Title", "## Summary", and "## Action Items"',
    );
  });

  it('has no raw notes block or raw notes rule without raw notes', () => {
    const text = base({ enhancement: createEnhancementContext({ agenda: 'Budget' }) });
    expect(text).not.toContain('<raw_notes>');
    expect(text).not.toContain('Treat the raw notes as important');
    expect(text).toContain('nothing else.\n<agenda>\nBudget\n</agenda>\n');
  });

  it('orders blocks raw notes, attendees, agenda, template instructions; trims and drops blanks', () => {
    const text = base({
      enhancement: createEnhancementContext({
        templateInstructions: ' Be brief ',
        agenda: ' Budget ',
        attendees: [' Ana ', '  ', 'Luis'],
        rawNotes: ' n ',
      }),
    });
    const tail = text.slice(SUMMARY_EN.length);
    expect(
      tail.endsWith(
        '<raw_notes>\nn\n</raw_notes>\n\n<attendees>\nAna, Luis\n</attendees>\n\n<agenda>\nBudget\n</agenda>\n\n<template_instructions>\nBe brief\n</template_instructions>\n',
      ),
    ).toBe(true);
    expect(tail).not.toMatch(/ {12}/);
  });
});

describe('map-reduce prompts', () => {
  it('buildPartPrompt matches spec 3.5', () => {
    expect(buildPartPrompt('PART', 2, 5, 'English'))
      .toBe(`You take notes on part 2 of 5 of an automatic-speech-recognition transcript.
Another step combines the notes from all parts, so anything you leave out is lost.

Respond only with Markdown bullets in English, about 300 words at most, with no preamble:
- The substantive points actually said.
- Decisions explicitly made, starting with "Decision:".
- Unresolved questions, starting with "Question:".
- Follow-ups as "- [ ] task", with an owner and a due date only when stated.

Keep the [mm:ss.ff-mm:ss.ff] range on decisions and follow-ups, and any Recorded or Ended stamp.
Ground every bullet in the text. Do not invent names, dates, or tasks.
If this part has nothing substantive, respond with one bullet that says so.

<transcript_part>
PART
</transcript_part>`);
  });

  it('buildMergePrompt matches spec 3.5', () => {
    expect(buildMergePrompt('NOTES', 'Spanish'))
      .toBe(`These are consecutive notes on a recording, in time order. Combine them into one shorter set.

Respond only with Markdown bullets in Spanish, about 300 words at most, with no preamble.
Remove repetition and minor detail. Keep every decision, open question, and follow-up,
with their "Decision:", "Question:", and "- [ ]" forms and their time ranges.
Do not invent anything that is not in the notes.

<notes_part>
NOTES
</notes_part>`);
  });
});
