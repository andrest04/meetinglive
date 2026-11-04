import { describe, expect, it } from 'vitest';
import { buildLiveAnswerPrompt } from './prompt-builder';
import { MAX_SESSION_CONTEXT_CHARS, buildSessionContext } from './session-context';
import { shouldUseWeb, supportsWebSearch } from './web-policy';

describe('LiveAnswerPromptBuilder', () => {
  it('Spanish prompt carries the question, the window and the fixed rules', () => {
    const p = buildLiveAnswerPrompt('What is DNS?', 'window text', 'es');
    for (const part of [
      'What is DNS?',
      'window text',
      'If the transcript does not contain the factual answer, answer from knowledge.',
      'Do not refuse just because the meeting did not state the fact.',
      'Do not say that you only know what was said.',
      'Spanish',
      '2 to 5 sentences',
      'live class or meeting',
      'who asked',
    ]) {
      expect(p).toContain(part);
    }
  });

  it('English asks for English and omits Spanish', () => {
    const p = buildLiveAnswerPrompt('q', 'w', ' EN ');
    expect(p).toContain('in English.');
    expect(p).not.toContain('Spanish');
  });

  it.each([null, undefined, 'fr', ''])('language %s falls back to Spanish', (language) => {
    const p = buildLiveAnswerPrompt('q', 'w', language);
    expect(p).toContain('Write the answer in Spanish.');
    expect(p).not.toContain('English');
    expect(p).not.toContain('French');
  });

  it('session context adds its block directly above Question', () => {
    const p = buildLiveAnswerPrompt('q', 'w', 'en', '  Meeting: Math  ');
    expect(p).toContain('Session context:\nMeeting: Math\n\nThe session context is');
    expect(p).toContain('interpret the question.\nQuestion:\nq');
  });

  it.each([null, '', '   '])('blank context %j omits the block', (context) => {
    expect(buildLiveAnswerPrompt('q', 'w', 'en', context)).not.toContain('Session context');
  });

  it('web search adds the web line with a blank line after it', () => {
    const p = buildLiveAnswerPrompt('q', 'w', 'en', null, true);
    expect(p).toContain(
      '(competitors, prices, recent news) and keep the answer short.\n\nQuestion:',
    );
  });

  it('without web search the word web never appears', () => {
    expect(buildLiveAnswerPrompt('q', 'w', 'es', 'ctx', false).toLowerCase()).not.toContain('web');
  });

  it('context plus web keeps the question and window sections', () => {
    const p = buildLiveAnswerPrompt('the q', 'the w', 'en', 'ctx', true);
    expect(p.endsWith('Question:\nthe q\n\nTranscript window:\nthe w')).toBe(true);
    expect(p).toContain('Session context:\nctx');
  });

  it('null question and window become empty', () => {
    expect(
      buildLiveAnswerPrompt(null, null, 'en').endsWith('Question:\n\n\nTranscript window:\n'),
    ).toBe(true);
  });
});

describe('LiveAnswerWebPolicy', () => {
  it('only the CLI providers support web search', () => {
    expect(supportsWebSearch('ClaudeCode')).toBe(true);
    expect(supportsWebSearch('Codex')).toBe(true);
    expect(supportsWebSearch('Xai')).toBe(false);
    expect(supportsWebSearch('Local')).toBe(false);
  });

  it('the typed question uses the web only when supported and forced', () => {
    expect(shouldUseWeb(true, true)).toBe(true);
    expect(shouldUseWeb(true, false)).toBe(false);
    expect(shouldUseWeb(false, true)).toBe(false);
    expect(shouldUseWeb(false, false)).toBe(false);
  });

  it.each([
    [null, null],
    ['  ', ''],
    [undefined, '\n'],
  ])('blank title and brief give null (%j, %j)', (title, brief) => {
    expect(buildSessionContext(title, brief)).toBeNull();
  });

  it('title only, brief only and both', () => {
    expect(buildSessionContext(' Math ', '')).toBe('Meeting: Math');
    expect(buildSessionContext('', '  about sets ')).toBe('about sets');
    expect(buildSessionContext('Math', 'sets')).toBe('Meeting: Math\nsets');
  });

  it('a long brief is cut at 1500 and trimmed at the end', () => {
    const brief = `${'a'.repeat(1490)} ${'b'.repeat(40)}`;
    const text = buildSessionContext('', brief);
    expect(text).toBe(brief.slice(0, MAX_SESSION_CONTEXT_CHARS).trimEnd());
    expect(text?.length).toBeLessThanOrEqual(MAX_SESSION_CONTEXT_CHARS);
    expect(buildSessionContext('', 'x'.repeat(3000))?.length).toBe(MAX_SESSION_CONTEXT_CHARS);
  });
});
