import { MEETING_LINK_PREFIX } from './meeting-link';
import type { ChatScopeKind } from './scope-resolver';
import { cutPrefix } from './text-cut';

export const MAX_PRIOR_MESSAGES = 8;
export const MAX_PRIOR_MESSAGE_CHARS = 1500;
export const REWRITE_NOTES_INSTRUCTION =
  'Rewrite the notes from the packed meeting and return the rewritten notes as markdown. Do not save the file.';

/** A past turn as the prompt sees it. `role` is the raw string (`user` or `assistant`). */
export interface ChatPromptMessage {
  readonly role: string;
  readonly text: string | null | undefined;
}

/** English only, never localized (spec 3.4). */
export function scopeLabel(kind: ChatScopeKind): string {
  switch (kind) {
    case 'AllMeetings':
      return 'All meetings';
    case 'Folder':
      return 'Folder';
    case 'Meeting':
      return 'Meeting';
    case 'Live':
      return 'Live';
    default:
      throw new RangeError('Unknown chat scope');
  }
}

const INSTRUCTIONS = [
  'Answer only from the packed context.',
  'If the context does not contain the answer, say so.',
  'Do not invent quotes, decisions, or attendees.',
  'Drafts (email, Slack, or spec) are drafts. Never claim something was sent.',
  'Answer in Markdown.',
  'Refer to meetings by title and a readable date (for example, "Sprint review on Sep 1").',
  'Do not mention how many meetings were included or omitted unless the user asks.',
  `When you refer to a meeting, cite it as a Markdown link: [Title, readable date](${MEETING_LINK_PREFIX}<Id>), using the meeting's Id from the context.`,
  'Only cite Ids that appear in the context. Never write a raw Id outside a link.',
];

/**
 * B12 (prompt side): the prompt's own section headings. A line of user or prior-turn text that
 * begins (after optional spaces or tabs) with one of them gets a `> ` prefix, so the model cannot
 * be shown a forged `# Context` or `# User message` section. The fixed prompt lines stay verbatim.
 */
const FORGED_SECTION = /^[ \t]*#[ \t]*(?:Context|Prior turns|User message)/i;

export function neutralizePromptSections(text: string): string {
  return text
    .split(/\r\n|[\r\n\u0085\u2028\u2029]/)
    .map((line) => (FORGED_SECTION.test(line) ? `> ${line}` : line))
    .join('\n');
}

const ANSWER_LANGUAGE = "Answer in the language of the user's message.";

const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });

/** The English name of a UI language tag (`es` gives `Spanish`), or null when there is none. */
export function answerLanguageName(tag: string | null | undefined): string | null {
  if (tag === null || tag === undefined || tag.trim() === '') return null;
  try {
    const language = new Intl.Locale(tag.trim().replaceAll('_', '-')).language;
    return languageNames.of(language) ?? null;
  } catch {
    return null;
  }
}

/**
 * T2 (fix for S8): the answer follows the user's language; the app language decides when that is
 * unclear, and recipes ask for it by name ("the app language").
 */
function answerLanguageRule(name: string | null | undefined): string {
  if (name === null || name === undefined || name.trim() === '') return ANSWER_LANGUAGE;
  return `${ANSWER_LANGUAGE} If it is unclear, or the message asks for the app language, answer in ${singleLineName(name)} (the app language).`;
}

const singleLineName = (name: string): string => name.replace(/\s+/g, ' ').trim();

export interface PromptOptions {
  /** English name of the UI language, for example `Spanish`. */
  readonly answerLanguage?: string | null;
}

/** The single string sent to the model (spec 3.4). No system/user split, no trailing newline. */
export function buildPrompt(
  scopeKind: ChatScopeKind,
  packedContext: string,
  priorMessages: readonly ChatPromptMessage[],
  userMessage: string,
  options: PromptOptions = {},
): string {
  const lines: string[] = [
    ...INSTRUCTIONS,
    answerLanguageRule(options.answerLanguage),
    `Scope: ${scopeLabel(scopeKind)}`,
  ];
  if (scopeKind === 'Meeting' && userMessage.toLowerCase().includes('rewrite')) {
    lines.push('', REWRITE_NOTES_INSTRUCTION);
  }
  const prior = priorMessages.slice(-MAX_PRIOR_MESSAGES).map((m) => {
    return `${m.role}: ${neutralizePromptSections(cutPrefix(m.text ?? '', MAX_PRIOR_MESSAGE_CHARS))}`;
  });
  lines.push(
    '',
    '# Context',
    packedContext,
    '',
    '# Prior turns',
    ...(prior.length ? prior : ['(none)']),
  );
  lines.push('', '# User message', neutralizePromptSections(userMessage));
  return lines.join('\n');
}
