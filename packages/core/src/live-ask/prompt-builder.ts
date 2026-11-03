/**
 * The live answer prompt (recording spec 3.12, live-copilot spec 3.1). The Live Copilot module
 * imports this same code. With web search off the text never contains the word "web".
 */

const WEB_LINE =
  'You may use web search for current or external facts (competitors, prices, recent news) and keep the answer short.\n\n';

/** English only when the summary language is `en`; every other value, including null, is Spanish. */
export function liveAnswerLanguageName(outputLanguage: string | null | undefined): string {
  return outputLanguage?.trim().toLowerCase() === 'en' ? 'English' : 'Spanish';
}

function contextBlock(sessionContext: string | null | undefined): string {
  const text = sessionContext?.trim() ?? '';
  if (text === '') return '';
  return (
    `Session context:\n${text}\n\n` +
    'The session context is the topic, course, or meeting brief supplied by the user. Use it to interpret the question.\n'
  );
}

export function buildLiveAnswerPrompt(
  question: string | null | undefined,
  transcriptWindow: string | null | undefined,
  outputLanguage: string | null | undefined,
  sessionContext: string | null | undefined = null,
  webSearch = false,
): string {
  const language = liveAnswerLanguageName(outputLanguage);
  return [
    'You are answering a question that was just asked in a live class or meeting.',
    '',
    `Write a short answer in 2 to 5 sentences. Write the answer in ${language}.`,
    '',
    'Use the transcript window as context for the topic and who asked.',
    '',
    'If the transcript does not contain the factual answer, answer from knowledge. Do not refuse just because the meeting did not state the fact. Do not say that you only know what was said.',
    '',
    `${contextBlock(sessionContext)}${webSearch ? WEB_LINE : ''}Question:`,
    question ?? '',
    '',
    'Transcript window:',
    transcriptWindow ?? '',
  ].join('\n');
}
