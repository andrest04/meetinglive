import { describe, expect, it } from 'vitest';
import { CancelSource, type CancelSignal } from '../cancel';
import {
  CliTimeoutError,
  CliToolError,
  classifyException,
  classifyFailure,
  runRequiredStdout,
  sanitizeSnippet,
  wrapCliError,
  type CliProcessRunner,
  type CliRunResult,
} from './cli-failure';
import { CancelledError, isCancellation } from './provider';

describe('classifyFailure order (spec 2.5)', () => {
  it('not on PATH wins over everything', () => {
    expect(classifyFailure(0, 'fine', '', false)).toBe('NotInstalled');
  });

  it('exit 0 with blank stdout is EmptyOutput, even with noisy stderr', () => {
    expect(classifyFailure(0, '  \n', 'unauthorized', true)).toBe('EmptyOutput');
    expect(classifyFailure(0, null, null)).toBe('EmptyOutput');
  });

  it.each([
    ['command not found', 'NotInstalled'],
    ['Cannot find the file', 'NotInstalled'],
    ['spawn claude ENOENT', 'NotInstalled'],
    ['402 Payment Required', 'SubscriptionInactive'],
    ['plan expired', 'SubscriptionInactive'],
    ['your subscription has ended', 'SubscriptionInactive'],
    ['billing problem', 'SubscriptionInactive'],
    ['quota exceeded', 'SubscriptionInactive'],
    ['out of credit', 'SubscriptionInactive'],
    ['not logged in', 'NotSignedIn'],
    ['Please sign in', 'NotSignedIn'],
    ['sign-in required', 'NotSignedIn'],
    ['Unauthorized', 'NotSignedIn'],
    ['session expired', 'NotSignedIn'],
    ['token expired', 'NotSignedIn'],
    ['authentication failed', 'NotSignedIn'],
    ['oauth error', 'NotSignedIn'],
    ['HTTP 401', 'NotSignedIn'],
    ['Please run claude to login again', 'NotSignedIn'],
    ['request timed out', 'TimedOut'],
    ['time-out reached', 'TimedOut'],
    ['timeout', 'TimedOut'],
    ['something odd happened', 'Unknown'],
  ])('stderr "%s" gives %s', (stderr, kind) => {
    expect(classifyFailure(1, '', stderr)).toBe(kind);
  });

  it('checks not-installed before subscription before sign-in before timeout', () => {
    expect(classifyFailure(1, '', 'not found, billing, sign in, timed out')).toBe('NotInstalled');
    expect(classifyFailure(1, '', 'billing, sign in, timed out')).toBe('SubscriptionInactive');
    expect(classifyFailure(1, '', 'sign in, timed out')).toBe('NotSignedIn');
    expect(classifyFailure(1, '', 'timed out')).toBe('TimedOut');
  });

  it('uses whole words for the short keywords', () => {
    expect(classifyFailure(1, '', 'authorization header missing')).toBe('Unknown');
    expect(classifyFailure(1, '', 'code 4010')).toBe('Unknown');
    expect(classifyFailure(1, '', 'creditable work')).toBe('Unknown');
    expect(classifyFailure(1, '', 'timeouts happen')).toBe('Unknown');
  });

  it('does not misread credential text as a subscription problem', () => {
    expect(classifyFailure(1, '', 'Invalid credentials')).toBe('Unknown');
    expect(classifyFailure(1, '', 'credentials file missing')).toBe('Unknown');
  });
});

describe('B12: classification input', () => {
  it('ignores summary words in stdout', () => {
    expect(
      classifyFailure(1, 'We discussed billing, the quota and the payment plan.', 'boom'),
    ).toBe('Unknown');
    expect(classifyFailure(1, 'The credit subscription was not found', '')).toBe('Unknown');
  });

  it('still reads stdout for a known sentinel phrase', () => {
    expect(classifyFailure(1, 'Error: not logged in', '')).toBe('NotSignedIn');
    expect(classifyFailure(1, 'Please run codex login first', '')).toBe('NotSignedIn');
    expect(classifyFailure(1, 'session expired', '')).toBe('NotSignedIn');
    expect(classifyFailure(1, 'HTTP 402 payment required', '')).toBe('SubscriptionInactive');
    expect(classifyFailure(1, 'plan expired', '')).toBe('SubscriptionInactive');
  });

  it('stderr wins over a stdout sentinel', () => {
    expect(classifyFailure(1, 'not logged in', 'request timed out')).toBe('TimedOut');
  });

  it('does not read "model not found" or "404 Not Found" as a missing program', () => {
    expect(classifyFailure(1, '', 'Error: model gpt-9 not found')).toBe('Unknown');
    expect(classifyFailure(1, '', 'The model "x" was not found for this account')).toBe('Unknown');
    expect(classifyFailure(1, '', 'HTTP 404 Not Found')).toBe('Unknown');
  });

  it('still reads a real missing program', () => {
    expect(classifyFailure(1, '', "'codex' is not recognized; command not found")).toBe(
      'NotInstalled',
    );
    expect(classifyFailure(1, '', 'model x not found. Also: codex not found')).toBe('NotInstalled');
  });
});

describe('sanitizeSnippet', () => {
  it('is null for blank input', () => {
    expect(sanitizeSnippet(null)).toBeNull();
    expect(sanitizeSnippet('   ')).toBeNull();
  });

  it('redacts bearer tokens, key assignments, sk- keys and JWTs', () => {
    expect(sanitizeSnippet('Authorization: Bearer abc.def')).toBe('Authorization: [redacted]');
    expect(sanitizeSnippet('api_key=hunter2 and Password: swordfish')).toBe(
      '[redacted] and [redacted]',
    );
    expect(sanitizeSnippet('key sk-abcdefgh12345')).toBe('key [redacted]');
    expect(sanitizeSnippet('jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 end')).toBe(
      'jwt [redacted] end',
    );
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeSnippet('  one\n\n two\t three  ')).toBe('one two three');
  });

  it('caps at 120 characters and adds an ellipsis', () => {
    const out = sanitizeSnippet('a'.repeat(300)) ?? '';
    expect(out).toBe(`${'a'.repeat(120)}…`);
    expect(sanitizeSnippet('a'.repeat(120))).toBe('a'.repeat(120));
  });
});

describe('CliToolError', () => {
  it('keeps a detail only for Unknown', () => {
    expect(new CliToolError('Codex', 'TimedOut', 'ignored').detail).toBeNull();
    expect(new CliToolError('Codex', 'Unknown', 'odd').detail).toBe('odd');
  });

  it('fromProcess keeps a sanitized snippet and never the exit code', () => {
    const error = CliToolError.fromProcess(
      'Claude Code',
      137,
      '',
      'weird failure token=abc123 happened',
    );
    expect(error.kind).toBe('Unknown');
    expect(error.detail).toBe('weird failure [redacted] happened');
    expect(error.message).not.toContain('137');
    expect(error.detail).not.toContain('abc123');
  });

  it('prefers stderr and falls back to stdout for the snippet', () => {
    expect(CliToolError.fromProcess('Codex', 2, 'from stdout', '').detail).toBe('from stdout');
    expect(CliToolError.fromProcess('Codex', 2, 'from stdout', 'from stderr').detail).toBe(
      'from stderr',
    );
  });

  it('does not attach a detail to a classified kind', () => {
    const error = CliToolError.fromProcess('Codex', 1, '', 'please sign in');
    expect(error.kind).toBe('NotSignedIn');
    expect(error.detail).toBeNull();
  });
});

describe('classifyException', () => {
  it('uses the kind of a CliToolError', () => {
    expect(classifyException(new CliToolError('Codex', 'EmptyOutput'))).toBe('EmptyOutput');
  });

  it('maps a timeout', () => {
    expect(classifyException(new CliTimeoutError())).toBe('TimedOut');
    const named = new Error('x');
    named.name = 'TimeoutError';
    expect(classifyException(named)).toBe('TimedOut');
  });

  it.each(['ENOENT', 'EACCES'])('maps the spawn error %s to NotInstalled', (code) => {
    const error = Object.assign(new Error('spawn failed'), { code });
    expect(classifyException(error)).toBe('NotInstalled');
  });

  it('classifies other errors by message with exit code 1', () => {
    expect(classifyException(new Error('executable not found on disk'))).toBe('NotInstalled');
    expect(classifyException(new Error('please sign in'))).toBe('NotSignedIn');
    expect(classifyException(new Error('weird'))).toBe('Unknown');
    expect(classifyException('plain text timed out')).toBe('TimedOut');
  });
});

describe('wrapCliError', () => {
  it('never wraps a cancellation', () => {
    const cancelled = new CancelledError();
    expect(wrapCliError('Codex', cancelled)).toBe(cancelled);
  });

  it('passes a CliToolError through', () => {
    const error = new CliToolError('Codex', 'EmptyOutput');
    expect(wrapCliError('Codex', error)).toBe(error);
  });

  it('wraps a timeout and keeps the cause', () => {
    const timeout = new CliTimeoutError();
    const wrapped = wrapCliError('Codex', timeout) as CliToolError;
    expect(wrapped).toBeInstanceOf(CliToolError);
    expect(wrapped.kind).toBe('TimedOut');
    expect(wrapped.displayName).toBe('Codex');
    expect(wrapped.cause).toBe(timeout);
  });

  it('keeps a sanitized snippet for an unknown exception', () => {
    const wrapped = wrapCliError('Codex', new Error('odd failure secret=abc')) as CliToolError;
    expect(wrapped.kind).toBe('Unknown');
    expect(wrapped.detail).toBe('odd failure [redacted]');
  });
});

function fakeRunner(
  options: { onPath?: boolean; result?: CliRunResult; throws?: Error } = {},
): CliProcessRunner & { runs: number } {
  const state = { runs: 0 };
  return {
    get runs() {
      return state.runs;
    },
    isOnPath: () => options.onPath ?? true,
    run: async (
      _exe: string,
      _args: readonly string[],
      _stdin: string | null,
      _t: number,
      _c: CancelSignal,
    ) => {
      state.runs += 1;
      if (options.throws !== undefined) return Promise.reject(options.throws);
      return options.result ?? { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  };
}

const run = (runner: CliProcessRunner, cancel: CancelSignal = new CancelSource().signal) =>
  runRequiredStdout(runner, 'codex', ['exec'], 'prompt', 1000, 'Codex', cancel);

describe('runRequiredStdout', () => {
  it('returns trimmed stdout on success', async () => {
    const runner = fakeRunner({ result: { exitCode: 0, stdout: '  answer \n', stderr: '' } });
    expect(await run(runner)).toBe('answer');
  });

  it('is NotInstalled before spawning when the program is not on PATH', async () => {
    const runner = fakeRunner({ onPath: false });
    const error = (await run(runner).catch((e: unknown) => e)) as CliToolError;
    expect(error.kind).toBe('NotInstalled');
    expect(runner.runs).toBe(0);
  });

  it('classifies a non-zero exit', async () => {
    const runner = fakeRunner({ result: { exitCode: 1, stdout: '', stderr: 'Please sign in' } });
    const error = (await run(runner).catch((e: unknown) => e)) as CliToolError;
    expect(error.kind).toBe('NotSignedIn');
  });

  it('keeps summary words from stdout out of the classification (B12)', async () => {
    const runner = fakeRunner({
      result: { exitCode: 3, stdout: 'billing quota credit payment', stderr: 'segfault' },
    });
    const error = (await run(runner).catch((e: unknown) => e)) as CliToolError;
    expect(error.kind).toBe('Unknown');
  });

  it('is EmptyOutput for blank stdout on success', async () => {
    const runner = fakeRunner({ result: { exitCode: 0, stdout: ' \n', stderr: '' } });
    const error = (await run(runner).catch((e: unknown) => e)) as CliToolError;
    expect(error.kind).toBe('EmptyOutput');
  });

  it('wraps a timeout from the runner', async () => {
    const error = (await run(fakeRunner({ throws: new CliTimeoutError() })).catch(
      (e: unknown) => e,
    )) as CliToolError;
    expect(error.kind).toBe('TimedOut');
  });

  it('maps a spawn ENOENT to NotInstalled', async () => {
    const enoent = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    const error = (await run(fakeRunner({ throws: enoent })).catch(
      (e: unknown) => e,
    )) as CliToolError;
    expect(error.kind).toBe('NotInstalled');
  });

  it('lets a cancellation from the runner through unchanged', async () => {
    const cancelled = new CancelledError();
    const error = await run(fakeRunner({ throws: cancelled })).catch((e: unknown) => e);
    expect(error).toBe(cancelled);
  });

  it('rejects as a cancellation when cancelled before the call', async () => {
    const source = new CancelSource();
    source.cancel();
    const runner = fakeRunner();
    const error = await run(runner, source.signal).catch((e: unknown) => e);
    expect(isCancellation(error)).toBe(true);
    expect(runner.runs).toBe(0);
  });

  it('rejects as a cancellation when cancelled during the run, whatever the result', async () => {
    const source = new CancelSource();
    const runner: CliProcessRunner = {
      isOnPath: () => true,
      run: async () => {
        source.cancel();
        return { exitCode: 1, stdout: '', stderr: 'killed' };
      },
    };
    const error = await run(runner, source.signal).catch((e: unknown) => e);
    expect(isCancellation(error)).toBe(true);
  });
});
