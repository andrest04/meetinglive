import { describe, expect, it } from 'vitest';
import { offsetDateFromInstant, parseOffsetDate } from '../library/offset-date';
import { SUMMARY_LANGUAGES } from '../settings/languages';
import {
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

You take notes from an automatic-speech-recognition transcript of any spoken recording:
meeting, class, talk, podcast, interview, tutorial, or video. The transcript may contain
ASR errors, false starts, and filler. You are a note-taker, not a novelist.

# Instructions

Respond with exactly three Markdown sections, in this order, and nothing else
(no preamble, no code fences, no closing commentary):

## Title

One short title, about 3–8 words. No quotes, no trailing period, no markdown.
Write the title in English. If the recording is an informal ASR test, say so
plainly (e.g. "Microphone test"). Do not copy <meeting_title> unless it already
describes the content. Ground it in the transcript; do not invent.

## Summary

Open with one or two sentences: what the recording is and its single most important
takeaway. If it is an informal ASR test or rambling, say so; do not dress it up.

Then silently decide the content type and add the 2–5 ### sections that serve it best,
with headings written in English. For example:
- meeting: decisions, topics, open questions
- class: key concepts with a short explanation each, examples, what to review
- talk, podcast, or interview: main thesis, arguments, notable quotes, takeaways
- tutorial: goal, numbered steps, tips and pitfalls

Group by topic, not chronology. Append the elapsed range in mm:ss to each point or
heading, e.g. (12:05–18:40). Use bullets, numbered lists, tables for comparisons, and
blockquotes (>) for verbatim quotes. No checkboxes and no ## headings in this body.
Omit a section with no content; do not pad.

## Action Items

Only real follow-ups that were stated or clearly agreed, each as a Markdown checkbox.
Include owner and due date only when the transcript states them. If priority was
stated, append it. Examples:
- [ ] Send the revised deck — Owner: Ana — Due: Friday
- [ ] Review the API contract

If there are none, leave this section empty (keep the heading); talks, classes, and
videos often have none.

Rules:
- Ground every sentence in the transcript. Do not invent attendees, dates, companies, or tasks.
- If a name or number is unclear because of ASR noise, paraphrase without guessing the spelling.
- Transcript lines are stamped [mm:ss.ff-mm:ss.ff] elapsed ranges from recording start, with optional [ Speaker-N ] labels. Use those ranges to place points in time (and Recorded/Ended for wall-clock bounds).
- Transcript may start with Recorded and Ended local stamps (yyyy-MM-dd HH:mm). Use those / <ended_at> as the meeting end. Never write that the end time was not recorded when Ended or <ended_at> is present. If missing, omit end time (do not invent, do not say "not recorded").
- Write the Title, the Summary body, and action-item text in English.
- Keep the Markdown headings exactly "## Title", "## Summary", and "## Action Items" in English.

# Context

<meeting_title>Weekly sync</meeting_title>
<recorded_at>2026-11-02T14:00:00.0000000-05:00</recorded_at>
<transcript>
hello there
</transcript>`;

const EN_EXAMPLES =
  '- [ ] Send the revised deck — Owner: Ana — Due: Friday\n- [ ] Review the API contract';
const ES_EXAMPLES =
  '- [ ] Enviar el deck revisado — Owner: Ana — Due: viernes\n- [ ] Revisar el contrato de la API';

/** The Summary section of the instructions, from its heading to the Action Items heading. */
const summarySection = (text: string): string =>
  text.slice(text.indexOf('\n## Summary\n'), text.indexOf('\n## Action Items\n'));

describe('buildSummaryPrompt snapshot', () => {
  it('matches spec 3.1 for English with no end time', () => {
    expect(base()).toBe(SUMMARY_EN);
  });

  it('differs for Spanish only in the language name and the action examples', () => {
    const expected = SUMMARY_EN.replaceAll(' in English.', ' in Spanish.')
      .replace('"## Action Items" in Spanish.', '"## Action Items" in English.')
      .replace(EN_EXAMPLES, ES_EXAMPLES);
    expect(base({ outputLanguage: 'es' })).toBe(expected);
  });

  it('asks for the gist first, then inferred ### sections written in the output language', () => {
    const section = summarySection(base());
    const gist = section.indexOf('Open with one or two sentences');
    const inferred = section.indexOf('silently decide the content type');
    expect(gist).toBeGreaterThan(0);
    expect(inferred).toBeGreaterThan(gist);
    expect(section).toContain('single most important\ntakeaway');
    expect(section).toContain('with headings written in English.');
    for (const type of ['meeting:', 'class:', 'talk, podcast, or interview:', 'tutorial:']) {
      expect(section).toContain(`\n- ${type}`);
    }
  });

  it('has no fixed ### subheadings and only the three contract ## headings', () => {
    for (const code of ['en', 'es']) {
      const text = base({ outputLanguage: code });
      expect(text).not.toMatch(/^### /m);
      expect(text.match(/^## .*$/gm)).toEqual(['## Title', '## Summary', '## Action Items']);
    }
  });

  it('asks for topic grouping, mm:ss ranges, renderer-safe formats, and no checkboxes or ## in the body', () => {
    const section = summarySection(base());
    expect(section).toContain('Group by topic, not chronology.');
    expect(section).toContain('elapsed range in mm:ss');
    expect(section).toContain('numbered lists, tables for comparisons');
    expect(section).toContain('blockquotes (>) for verbatim quotes');
    expect(section).toContain('No checkboxes and no ## headings in this body.');
    expect(section).toContain('do not pad');
    expect(section).not.toContain('- [ ]');
  });

  it('keeps action items to real follow-ups and allows an empty section', () => {
    const text = base();
    expect(text).toContain('Only real follow-ups that were stated or clearly agreed');
    expect(text).toContain('leave this section empty (keep the heading)');
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

  it('stays compact enough for the local final-step budget', () => {
    for (const code of ['en', 'es']) {
      expect(base({ outputLanguage: code, transcript: '' }).length).toBeLessThanOrEqual(3050);
    }
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

  it('English action examples only for a trimmed, case-insensitive en', () => {
    expect(base({ outputLanguage: '  En ' })).toContain(EN_EXAMPLES);
    const french = base({ outputLanguage: 'fr' });
    expect(french).toContain(ES_EXAMPLES);
    expect(french).toContain('with headings written in French.');
    expect(french).toContain('Write the title in French.');
  });

  it('blank and unknown codes write Spanish', () => {
    for (const code of [null, 'xx']) {
      const text = base({ outputLanguage: code });
      expect(text).toContain('with headings written in Spanish.');
      expect(text).toContain(ES_EXAMPLES);
    }
  });

  it('B27: every code the Settings picker offers names its language for the headings', () => {
    for (const { code } of SUMMARY_LANGUAGES) {
      const name = toEnglishLanguageName(code);
      expect(base({ outputLanguage: code })).toContain(`with headings written in ${name}.`);
    }
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
  it('template instructions replace the inferred ### sections and keep the contract headings', () => {
    const rule =
      '- <template_instructions> sets the Summary body structure: it replaces the inferred ### sections. The three ## headings still apply.';
    const withTemplate = base({
      enhancement: createEnhancementContext({ templateInstructions: 'Shape as a 1:1' }),
    });
    expect(withTemplate).toContain(
      `"## Action Items" in that order, and nothing else.\n${rule}\n<template_instructions>\nShape as a 1:1\n</template_instructions>\n`,
    );
    const withoutTemplate = base({ enhancement: createEnhancementContext({ agenda: 'Budget' }) });
    expect(withoutTemplate).not.toContain('replaces the inferred');
  });
});

describe('map-reduce prompts', () => {
  it('buildPartPrompt matches spec 3.5', () => {
    expect(buildPartPrompt('PART', 2, 5, 'English'))
      .toBe(`You take notes on part 2 of 5 of an automatic-speech-recognition transcript.
Another step combines the notes from all parts, so anything you leave out is lost.

Respond only in English, about 300 words at most, no preamble.
First line: "Type:" and the content type (meeting, class, talk, podcast, interview, tutorial, other).
Then Markdown bullets:
- Points; concepts with their definitions; steps in order; arguments.
- Notable quotes, verbatim.
- Decisions as "Decision:", unresolved questions as "Question:".
- Follow-ups as "- [ ] task", with an owner and a due date only when stated.

Keep the [mm:ss.ff-mm:ss.ff] range on every bullet, and any Recorded or Ended stamp.
Ground every bullet in the text. Do not invent names, dates, or tasks.
If this part has nothing substantive, respond with one bullet that says so.

<transcript_part>
PART
</transcript_part>`);
  });

  it('buildPartPrompt keeps the content type and type-relevant material', () => {
    const text = buildPartPrompt('PART', 1, 1, 'Spanish');
    expect(text).toContain('Respond only in Spanish');
    for (const fragment of [
      'First line: "Type:"',
      'concepts with their definitions',
      'steps in order',
      'arguments',
      'Notable quotes, verbatim',
      '"Decision:"',
      '"Question:"',
      '"- [ ] task"',
      'range on every bullet',
    ]) {
      expect(text).toContain(fragment);
    }
    expect(text).not.toContain('\r');
  });

  it('buildMergePrompt matches spec 3.5', () => {
    expect(buildMergePrompt('NOTES', 'Spanish'))
      .toBe(`These are consecutive notes on a recording, in time order. Combine them into one shorter set.

Respond only in Spanish, about 300 words at most, no preamble: one "Type:" line, then
Markdown bullets. Drop repetition and minor detail. Keep concepts with definitions,
steps in order, arguments, verbatim quotes, and every "Decision:", "Question:", and
follow-up ("- [ ]"), with their time ranges. Do not invent anything not in the notes.

<notes_part>
NOTES
</notes_part>`);
  });

  it('map-reduce prompts stay compact', () => {
    for (const language of ['English', 'Spanish']) {
      expect(buildPartPrompt('', 64, 64, language).length).toBeLessThanOrEqual(872);
      expect(buildMergePrompt('', language).length).toBeLessThanOrEqual(491);
    }
  });
});
