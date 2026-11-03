import { formatOffsetDate, type OffsetDate } from '../library/offset-date';

/**
 * Prompt builders, spec 3.1, 3.2 and 3.5. The text is the WinUI app's, word for word. Newlines are
 * LF (the original used the platform newline and 12 spaces of indentation inside the enhancement
 * blocks; both were artefacts the model ignores).
 */

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  es: 'Spanish',
  en: 'English',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  ja: 'Japanese',
  zh: 'Chinese',
};

/** The language name written into the prompt. Blank and unknown codes mean Spanish. */
export function toEnglishLanguageName(code: string | null | undefined): string {
  const key = (code ?? '').trim().toLowerCase();
  return Object.hasOwn(LANGUAGE_NAMES, key) ? (LANGUAGE_NAMES[key] ?? 'Spanish') : 'Spanish';
}

export interface SummaryHeadings {
  readonly whatThisWas: string;
  readonly keyPoints: string;
  readonly decisions: string;
  readonly openQuestions: string;
}

/**
 * B27: headings are keyed by language code. Only `es` and `en` are populated, which are the codes
 * the Settings picker offers. Any other code falls back to Spanish, as the WinUI app does.
 */
const SPANISH_HEADINGS: SummaryHeadings = {
  whatThisWas: 'Qué fue esto',
  keyPoints: 'Puntos clave',
  decisions: 'Decisiones',
  openQuestions: 'Preguntas abiertas',
};

export const SUMMARY_HEADINGS: Readonly<Record<string, SummaryHeadings>> = {
  en: {
    whatThisWas: 'What this was',
    keyPoints: 'Key points',
    decisions: 'Decisions',
    openQuestions: 'Open questions',
  },
  es: SPANISH_HEADINGS,
};

const ACTION_EXAMPLES: Readonly<Record<'en' | 'es', string>> = {
  en: '- [ ] Send the revised deck — Owner: Ana — Due: Friday\n- [ ] Review the API contract',
  es: '- [ ] Enviar el deck revisado — Owner: Ana — Due: viernes\n- [ ] Revisar el contrato de la API',
};

const isEnglish = (code: string | null | undefined): boolean =>
  (code ?? '').trim().toLowerCase() === 'en';

/** The key used for headings and examples: `en` for English, `es` for everything else. */
const contentKey = (code: string | null | undefined): 'en' | 'es' =>
  isEnglish(code) ? 'en' : 'es';

export interface SummaryEnhancementInput {
  readonly rawNotes?: string | null;
  readonly attendees?: readonly string[] | null;
  readonly agenda?: string | null;
  readonly templateInstructions?: string | null;
}

export interface SummaryEnhancementContext {
  readonly rawNotes: string | null;
  readonly attendees: readonly string[];
  readonly agenda: string | null;
  readonly templateInstructions: string | null;
  readonly hasRawNotes: boolean;
  readonly hasAttendees: boolean;
  readonly hasAgenda: boolean;
  readonly hasTemplateInstructions: boolean;
  readonly hasAny: boolean;
}

const isBlank = (value: string | null | undefined): boolean => (value ?? '').trim() === '';
const lf = (value: string): string => value.replace(/\r\n?/g, '\n');

export function createEnhancementContext(
  input: SummaryEnhancementInput,
): SummaryEnhancementContext {
  const attendees = input.attendees ?? [];
  const hasRawNotes = !isBlank(input.rawNotes);
  const hasAttendees = attendees.some((name) => !isBlank(name));
  const hasAgenda = !isBlank(input.agenda);
  const hasTemplateInstructions = !isBlank(input.templateInstructions);
  return {
    rawNotes: input.rawNotes ?? null,
    attendees,
    agenda: input.agenda ?? null,
    templateInstructions: input.templateInstructions ?? null,
    hasRawNotes,
    hasAttendees,
    hasAgenda,
    hasTemplateInstructions,
    hasAny: hasRawNotes || hasAttendees || hasAgenda || hasTemplateInstructions,
  };
}

export interface SummaryPromptInput {
  readonly title: string;
  readonly recordedAt: OffsetDate;
  readonly transcript: string;
  readonly outputLanguage: string | null | undefined;
  readonly endedAt?: OffsetDate | null;
  readonly enhancement?: SummaryEnhancementContext | null;
}

const iso = (date: OffsetDate): string => formatOffsetDate(date, 'round-trip');

export function buildSummaryPrompt(input: SummaryPromptInput): string {
  const { title, recordedAt, transcript, outputLanguage, endedAt, enhancement } = input;
  const languageName = toEnglishLanguageName(outputLanguage);
  const key = contentKey(outputLanguage);
  const headings = SUMMARY_HEADINGS[key] ?? SPANISH_HEADINGS;
  const actionExamples = ACTION_EXAMPLES[key];
  const endedAtBlock = endedAt ? `\n<ended_at>${iso(endedAt)}</ended_at>` : '';

  const prompt = `# Identity

You extract meeting and lecture notes from an automatic-speech-recognition transcript.
The transcript may contain ASR errors, false starts, and filler. You are a note-taker,
not a novelist.

# Instructions

Respond with exactly three Markdown sections, in this order, and nothing else
(no preamble, no code fences, no closing commentary):

## Title

One short title, about 3–8 words. No quotes, no trailing period, no markdown.
Write the title in ${languageName}. If the recording is an informal ASR test, say so
plainly (e.g. "Microphone test"). Do not copy <meeting_title> unless it already
describes the content. Ground it in the transcript; do not invent.

## Summary

Use these subheadings inside the Summary body, verbatim (omit a subheading if that
content is not in the transcript):

### ${headings.whatThisWas}
One or two sentences: meeting, class, informal test, or unclear.

### ${headings.keyPoints}
Bullet list of substantive points actually said.

### ${headings.decisions}
Bullet list of decisions that were explicitly made. If none, omit this subheading.

### ${headings.openQuestions}
Unresolved questions or disagreements. If none, omit this subheading.

## Action Items

Each follow-up as a Markdown checkbox. Include owner and due date only when the
transcript states them. If priority was stated, append it. Examples:
${actionExamples}

If there are no action items, leave this section empty (keep the heading).

Rules:
- Ground every sentence in the transcript. Do not invent attendees, dates, companies, or tasks.
- If the recording is an informal ASR test or rambling, say so in "${headings.whatThisWas}". Do not dress it up as a formal meeting.
- If a name or number is unclear because of ASR noise, paraphrase without guessing the spelling.
- Transcript lines are stamped [mm:ss.ff-mm:ss.ff] elapsed ranges from recording start, with optional [ Speaker-N ] labels. When placing a key point, decision, or quote in time, use that elapsed range (and Recorded/Ended for wall-clock meeting bounds).
- Transcript may start with Recorded and Ended local stamps (yyyy-MM-dd HH:mm). Use those / <ended_at> as the meeting end. Never write that the end time was not recorded when Ended or <ended_at> is present. If missing, omit end time (do not invent, do not say "not recorded").
- Write the Title, the Summary body, and action-item text in ${languageName}.
- Use the ### subheadings above verbatim — do not translate them.
- Keep the Markdown headings exactly "## Title", "## Summary", and "## Action Items" in English.

# Context

<meeting_title>${title}</meeting_title>
<recorded_at>${iso(recordedAt)}</recorded_at>${endedAtBlock}
<transcript>
${transcript}
</transcript>`;

  if (!enhancement?.hasAny) return prompt;
  return `${prompt}\n${enhancementRules(enhancement)}${enhancementBlocks(enhancement)}`;
}

function enhancementRules(enhancement: SummaryEnhancementContext): string {
  const rawNotesRule = enhancement.hasRawNotes
    ? '\n- Treat the raw notes as important. Include those points. Fix typos. Fill structure from the transcript.'
    : '';
  return `Extra rules for the supplied context:
- Do not invent attendees, dates, quotes, or tasks that are not in the transcript or the supplied context.
- Still emit exactly "## Title", "## Summary", and "## Action Items" in that order, and nothing else.${rawNotesRule}`;
}

/** Each block is a newline, the open tag, the value, the close tag, each on its own line. */
function enhancementBlocks(enhancement: SummaryEnhancementContext): string {
  const block = (tag: string, value: string): string =>
    `\n<${tag}>\n${lf(value.trim())}\n</${tag}>\n`;
  let blocks = '';
  if (enhancement.hasRawNotes) blocks += block('raw_notes', enhancement.rawNotes ?? '');
  if (enhancement.hasAttendees) {
    const names = enhancement.attendees
      .filter((name) => !isBlank(name))
      .map((name) => name.trim())
      .join(', ');
    blocks += block('attendees', names);
  }
  if (enhancement.hasAgenda) blocks += block('agenda', enhancement.agenda ?? '');
  if (enhancement.hasTemplateInstructions) {
    blocks += block('template_instructions', enhancement.templateInstructions ?? '');
  }
  return blocks;
}

/** Spec 3.2: the title-only prompt. */
export function buildTitlePrompt(
  transcript: string,
  recordedAt: OffsetDate,
  outputLanguage: string | null | undefined,
): string {
  const languageName = toEnglishLanguageName(outputLanguage);
  return `# Identity

You name a recording from an automatic-speech-recognition transcript.
The transcript may contain ASR errors, false starts, and filler.

# Instructions

Return ONLY a short title, about 3–8 words. Nothing else:
no preamble, no code fences, no ## headings, no quotes, no trailing period.

Write the title in ${languageName}.
Ground it in the transcript. Do not invent.
If the recording is an informal ASR test, say so plainly (e.g. Microphone test).
This is an explicit regenerate: do not copy a current title; name the recording from the transcript.

# Context

<recorded_at>${iso(recordedAt)}</recorded_at>
<transcript>
${transcript}
</transcript>`;
}

/** Spec 3.5: notes for one part of a long transcript. `language` is the English language name. */
export function buildPartPrompt(
  part: string,
  number: number,
  total: number,
  language: string,
): string {
  return `You take notes on part ${number} of ${total} of an automatic-speech-recognition transcript.
Another step combines the notes from all parts, so anything you leave out is lost.

Respond only with Markdown bullets in ${language}, about 300 words at most, with no preamble:
- The substantive points actually said.
- Decisions explicitly made, starting with "Decision:".
- Unresolved questions, starting with "Question:".
- Follow-ups as "- [ ] task", with an owner and a due date only when stated.

Keep the [mm:ss.ff-mm:ss.ff] range on decisions and follow-ups, and any Recorded or Ended stamp.
Ground every bullet in the text. Do not invent names, dates, or tasks.
If this part has nothing substantive, respond with one bullet that says so.

<transcript_part>
${part}
</transcript_part>`;
}

/** Spec 3.5: combines consecutive part notes into one shorter set. */
export function buildMergePrompt(notes: string, language: string): string {
  return `These are consecutive notes on a recording, in time order. Combine them into one shorter set.

Respond only with Markdown bullets in ${language}, about 300 words at most, with no preamble.
Remove repetition and minor detail. Keep every decision, open question, and follow-up,
with their "Decision:", "Question:", and "- [ ]" forms and their time ranges.
Do not invent anything that is not in the notes.

<notes_part>
${notes}
</notes_part>`;
}
