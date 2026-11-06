import { describe, expect, it } from 'vitest';
import {
  CLAUDE_LEAN_FLAGS,
  InvalidCliOptionError,
  claudePrintArgs,
  claudePrintLine,
  claudeStreamArgs,
  codexExecArgs,
  codexExecLine,
  codexStreamArgs,
  validateCliOption,
} from './cli-invocation';

describe('Claude print invocation', () => {
  it('is a bare -p without options', () => {
    expect(claudePrintArgs()).toEqual(['-p', ...CLAUDE_LEAN_FLAGS]);
    expect(claudePrintLine(null, null)).toBe('-p');
    expect(claudePrintLine('  ', '')).toBe('-p');
  });

  it('adds model and effort in that order, each only when set', () => {
    expect(claudePrintArgs({ model: 'sonnet', effort: 'low' })).toEqual([
      '-p',
      ...CLAUDE_LEAN_FLAGS,
      '--model',
      'sonnet',
      '--effort',
      'low',
    ]);
    expect(claudePrintArgs({ model: ' opus ' })).toEqual([
      '-p',
      ...CLAUDE_LEAN_FLAGS,
      '--model',
      'opus',
    ]);
    expect(claudePrintArgs({ effort: 'high' })).toEqual([
      '-p',
      ...CLAUDE_LEAN_FLAGS,
      '--effort',
      'high',
    ]);
    expect(claudePrintLine('sonnet', 'low')).toBe('-p --model sonnet --effort low');
  });

  it('adds the web search tool flags after the model and effort', () => {
    expect(claudePrintArgs({ model: 'sonnet', effort: 'low', webSearch: true })).toEqual([
      '-p',
      ...CLAUDE_LEAN_FLAGS,
      '--model',
      'sonnet',
      '--effort',
      'low',
      '--tools',
      'WebSearch',
      '--allowedTools',
      'WebSearch',
    ]);
    expect(claudePrintLine('sonnet', null, true)).toBe(
      '-p --model sonnet --tools WebSearch --allowedTools WebSearch',
    );
  });

  it('leaves web search out unless asked', () => {
    expect(claudePrintArgs({ model: 'sonnet', webSearch: false })).not.toContain('--tools');
  });
});

describe('Codex exec invocation', () => {
  it('is a bare exec - without options', () => {
    expect(codexExecArgs()).toEqual(['exec', '-']);
    expect(codexExecLine(null, null)).toBe('exec -');
  });

  it('adds -m and the reasoning effort config', () => {
    expect(codexExecArgs({ model: 'gpt-5.6', effort: 'low' })).toEqual([
      'exec',
      '-',
      '-m',
      'gpt-5.6',
      '-c',
      'model_reasoning_effort="low"',
    ]);
    expect(codexExecLine('gpt-5.6', 'low')).toBe(
      'exec - -m gpt-5.6 -c model_reasoning_effort="low"',
    );
  });

  it('puts --search before exec', () => {
    expect(codexExecArgs({ model: 'gpt-5.6', webSearch: true })).toEqual([
      '--search',
      'exec',
      '-',
      '-m',
      'gpt-5.6',
    ]);
    expect(codexExecLine(null, null, true)).toBe('--search exec -');
  });
});

describe('streaming invocation', () => {
  it('asks Claude for partial stream-json events, keeping model, effort and web search', () => {
    expect(claudeStreamArgs({ model: 'sonnet', effort: 'low', webSearch: true })).toEqual([
      '-p',
      ...CLAUDE_LEAN_FLAGS,
      '--model',
      'sonnet',
      '--effort',
      'low',
      '--tools',
      'WebSearch',
      '--allowedTools',
      'WebSearch',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]);
  });

  it('asks Codex exec for JSONL events, keeping --search before exec', () => {
    expect(codexStreamArgs({ model: 'gpt-5.6', effort: 'low', webSearch: true })).toEqual([
      '--search',
      'exec',
      '-',
      '-m',
      'gpt-5.6',
      '-c',
      'model_reasoning_effort="low"',
      '--json',
    ]);
  });
});

describe('legacy string form', () => {
  it('quotes a model with a space and nothing else, as WinUI did', () => {
    expect(claudePrintLine('my model', null)).toBe('-p --model "my model"');
    expect(codexExecLine('my model', null)).toBe('exec - -m "my model"');
  });
});

describe('B30 option validation', () => {
  it('accepts every listed choice', () => {
    for (const model of ['sonnet', 'opus', 'haiku', 'fable']) {
      expect(claudePrintArgs({ model })).toContain(model);
    }
    expect(codexExecArgs({ model: 'gpt-5.6-sol', effort: 'xhigh' })).toContain('gpt-5.6-sol');
  });

  it('accepts a stored value outside the list when it is a plain identifier', () => {
    expect(claudePrintArgs({ model: 'claude-sonnet-4.5:beta_1' })).toContain(
      'claude-sonnet-4.5:beta_1',
    );
    expect(codexExecArgs({ effort: 'ultra' })).toContain('model_reasoning_effort="ultra"');
  });

  it.each([
    'two words',
    'a;b',
    'a&&b',
    '$(whoami)',
    'a"b',
    "a'b",
    '`x`',
    'a|b',
    'a\nb',
    '--tools',
    '-x',
    '..\\evil',
  ])('refuses %j', (value) => {
    expect(() => claudePrintArgs({ model: value })).toThrow(InvalidCliOptionError);
    expect(() => claudePrintArgs({ effort: value })).toThrow(InvalidCliOptionError);
    expect(() => codexExecArgs({ model: value })).toThrow(InvalidCliOptionError);
    expect(() => codexExecArgs({ effort: value })).toThrow(InvalidCliOptionError);
  });

  it('names the option in a clear message', () => {
    expect(() => validateCliOption('model', 'a b', [])).toThrow(/model "a b" is not allowed/);
    const error = (() => {
      try {
        validateCliOption('effort', 'x'.repeat(60) + ' y', []);
      } catch (e) {
        return e as InvalidCliOptionError;
      }
      return null;
    })();
    expect(error?.option).toBe('effort');
    expect(error?.message.length).toBeLessThan(200);
  });

  it('treats blank as not set', () => {
    expect(validateCliOption('model', '   ', [])).toBeNull();
    expect(validateCliOption('model', undefined, [])).toBeNull();
  });
});
