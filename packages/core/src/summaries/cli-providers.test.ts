import { describe, expect, it } from 'vitest';
import { CancelSource, type CancelSignal } from '../cancel';
import { parseOffsetDate } from '../library/offset-date';
import { CliTimeoutError, CliToolError } from './cli-failure';
import {
  CLAUDE_LEAN_FLAGS,
  CLAUDE_STREAM_FLAGS,
  CODEX_STREAM_FLAGS,
  InvalidCliOptionError,
  claudeImageArgs,
  codexImageArgs,
} from './cli-invocation';
import {
  CLI_TIMEOUT_MS,
  CliExitError,
  type CliLineRunner,
  type CliPromptOptions,
  type CliRunOptions,
} from './cli-provider';
import { CLAUDE_STREAM_JSON_LINES } from './fixtures/claude-stream-json';
import { CODEX_EXEC_JSON_LINES } from './fixtures/codex-exec-json';
import {
  createClaudeCodeProvider,
  createClaudeCodeWebSearchProvider,
} from './claude-code-provider';
import { createCodexProvider, createCodexWebSearchProvider } from './codex-provider';
import { buildSummaryPrompt } from './prompt-builders';
import { CancelledError, isCancellation, type SummaryProvider } from './provider';
import { describeSummaryProviderContract } from './provider-contract';
import { FakeCliProcessRunner, type FakeRunCall } from './test-kit';

const at = (text: string) => {
  const parsed = parseOffsetDate(text);
  if (!parsed) throw new Error(text);
  return parsed;
};
const recordedAt = at('2026-11-02T14:00:00.0000000-05:00');
const endedAt = at('2026-11-02T15:00:00.0000000-05:00');
const cancel = () => new CancelSource().signal;

const REPLY = `## Title
Budget review

## Summary
### What this was
Budget talk.

## Action Items
- [ ] Send it
`;

interface Flavor {
  readonly name: string;
  readonly id: 'claude-code' | 'codex';
  readonly executable: string;
  readonly displayName: string;
  readonly plainArgs: readonly string[];
  readonly make: (runner: FakeCliProcessRunner, timeoutMs?: number) => SummaryProvider;
  readonly makeWeb: (runner: FakeCliProcessRunner) => SummaryProvider;
  readonly makeWith: (
    runner: FakeCliProcessRunner,
    model: string,
    effort: string,
  ) => SummaryProvider;
  readonly configuredArgs: readonly string[];
}

const flavors: Flavor[] = [
  {
    name: 'Claude Code',
    id: 'claude-code',
    executable: 'claude',
    displayName: 'Claude Code',
    plainArgs: ['-p', ...CLAUDE_LEAN_FLAGS],
    make: (r, timeoutMs) => createClaudeCodeProvider(r, { timeoutMs }),
    makeWeb: (r) => createClaudeCodeWebSearchProvider(r, { model: 'sonnet' }),
    makeWith: (r, model, effort) => createClaudeCodeProvider(r, { model, effort }),
    configuredArgs: ['-p', ...CLAUDE_LEAN_FLAGS, '--model', 'sonnet', '--effort', 'low'],
  },
  {
    name: 'Codex',
    id: 'codex',
    executable: 'codex',
    displayName: 'Codex',
    plainArgs: ['exec', '-'],
    make: (r, timeoutMs) => createCodexProvider(r, { timeoutMs }),
    makeWeb: (r) => createCodexWebSearchProvider(r, { model: 'gpt-5.6' }),
    makeWith: (r, model, effort) => createCodexProvider(r, { model, effort }),
    configuredArgs: ['exec', '-', '-m', 'gpt-5.6', '-c', 'model_reasoning_effort="low"'],
  },
];

for (const f of flavors) {
  describeSummaryProviderContract(
    f.name,
    (reply) => {
      const runner = new FakeCliProcessRunner(reply);
      return { provider: f.make(runner), sentPrompts: () => runner.sentPrompts() };
    },
    f.id,
  );

  describe(`${f.name} provider`, () => {
    const request = {
      transcript: 'We went over the budget.',
      title: 'Budget',
      recordedAt,
      endedAt,
      outputLanguage: 'en',
      enhancement: null,
    };

    it('runs the right executable with the prompt on stdin and returns trimmed stdout', async () => {
      const runner = new FakeCliProcessRunner('  answer \n');
      const out = await f.make(runner).completePrompt('Say hi', cancel());
      expect(out).toBe('answer');
      expect(runner.pathChecks).toEqual([f.executable]);
      expect(runner.calls).toEqual([
        { executable: f.executable, args: f.plainArgs, stdin: 'Say hi', timeoutMs: CLI_TIMEOUT_MS },
      ]);
    });

    it('uses a five minute timeout by default and an injected one when given', async () => {
      expect(CLI_TIMEOUT_MS).toBe(300_000);
      const runner = new FakeCliProcessRunner('x');
      await f.make(runner, 1234).completePrompt('p', cancel());
      expect(runner.calls[0]?.timeoutMs).toBe(1234);
    });

    it('passes model and effort as separate argv items', async () => {
      const runner = new FakeCliProcessRunner('x');
      const [model] = f.configuredArgs.filter((a) => a === 'sonnet' || a === 'gpt-5.6');
      await f.makeWith(runner, model ?? '', 'low').completePrompt('p', cancel());
      expect(runner.calls[0]?.args).toEqual(f.configuredArgs);
    });

    it('sends the whole summary prompt, with and without ended_at', async () => {
      const withEnd = new FakeCliProcessRunner(REPLY);
      await f.make(withEnd).summarize(request, cancel());
      expect(withEnd.calls[0]?.stdin).toBe(buildSummaryPrompt(request));
      expect(withEnd.calls[0]?.stdin).toContain('</ended_at>');
      const noEnd = new FakeCliProcessRunner(REPLY);
      await f.make(noEnd).summarize({ ...request, endedAt: null }, cancel());
      expect(noEnd.calls[0]?.stdin).not.toContain('</ended_at>');
    });

    it('asks for section headings in the output language by language code', async () => {
      const en = new FakeCliProcessRunner(REPLY);
      await f.make(en).summarize(request, cancel());
      expect(en.calls[0]?.stdin).toContain('with headings written in English.');
      const es = new FakeCliProcessRunner(REPLY);
      await f.make(es).summarize({ ...request, outputLanguage: 'es' }, cancel());
      expect(es.calls[0]?.stdin).toContain('with headings written in Spanish.');
    });

    it('sets the suggested title from the summary reply', async () => {
      const result = await f.make(new FakeCliProcessRunner(REPLY)).summarize(request, cancel());
      expect(result.suggestedTitle).toBe('Budget review');
      expect(result.providerId).toBe(f.id);
    });

    it('is plain by default and adds web search only from the explicit factory', async () => {
      const plain = new FakeCliProcessRunner('x');
      await f.make(plain).completePrompt('p', cancel());
      expect(plain.calls[0]?.args).not.toContain(f.id === 'codex' ? '--search' : '--tools');
      const web = new FakeCliProcessRunner('x');
      await f.makeWeb(web).completePrompt('p', cancel());
      const args = web.calls[0]?.args ?? [];
      if (f.id === 'codex') {
        expect(args[0]).toBe('--search');
        expect(args.indexOf('--search')).toBeLessThan(args.indexOf('exec'));
      } else {
        expect(args.slice(-4)).toEqual(['--tools', 'WebSearch', '--allowedTools', 'WebSearch']);
      }
    });

    it('throws NotInstalled with the display name and never spawns', async () => {
      const runner = new FakeCliProcessRunner('x');
      runner.onPath = false;
      const error = await f
        .make(runner)
        .completePrompt('p', cancel())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CliToolError);
      expect((error as CliToolError).kind).toBe('NotInstalled');
      expect((error as CliToolError).displayName).toBe(f.displayName);
      expect(runner.calls).toEqual([]);
    });

    it('classifies a non-zero exit', async () => {
      const runner = new FakeCliProcessRunner();
      runner.result = { exitCode: 1, stdout: '', stderr: 'Error: not logged in' };
      const error = await f
        .make(runner)
        .summarize(request, cancel())
        .catch((e: unknown) => e);
      expect((error as CliToolError).kind).toBe('NotSignedIn');
    });

    it('throws EmptyOutput for blank stdout with exit 0', async () => {
      const error = await f
        .make(new FakeCliProcessRunner('  \n'))
        .summarize(request, cancel())
        .catch((e: unknown) => e);
      expect((error as CliToolError).kind).toBe('EmptyOutput');
    });

    it('maps a runner timeout to TimedOut', async () => {
      const runner = new FakeCliProcessRunner();
      runner.fail = new CliTimeoutError();
      const error = await f
        .make(runner)
        .completePrompt('p', cancel())
        .catch((e: unknown) => e);
      expect((error as CliToolError).kind).toBe('TimedOut');
    });

    it('never wraps a cancellation', async () => {
      const runner = new FakeCliProcessRunner();
      runner.fail = new CancelledError();
      const error = await f
        .make(runner)
        .completePrompt('p', cancel())
        .catch((e: unknown) => e);
      expect(isCancellation(error)).toBe(true);
      expect(error).not.toBeInstanceOf(CliToolError);
    });

    it('refuses an unsafe model before any spawn', async () => {
      const runner = new FakeCliProcessRunner('x');
      const error = await f
        .makeWith(runner, 'a b; rm -rf /', 'low')
        .completePrompt('p', cancel())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidCliOptionError);
      expect(runner.calls).toEqual([]);
    });
  });
}

/** A runner that can also stream stdout lines, like the Node runner. */
class FakeLineRunner extends FakeCliProcessRunner implements CliLineRunner {
  readonly lineCalls: (FakeRunCall & { readonly cwd?: string })[] = [];
  lines: readonly string[] = [];
  /** Thrown after the lines, like a process that exits non-zero. */
  failAfterLines: unknown = null;
  /** Lines handed out so far, to check chunks arrive before the process ends. */
  delivered = 0;

  async *runLines(
    executable: string,
    args: readonly string[],
    stdin: string | null,
    timeoutMs: number,
    _cancel: CancelSignal,
    options?: CliRunOptions,
  ): AsyncIterable<string> {
    this.lineCalls.push({
      executable,
      args: [...args],
      stdin,
      timeoutMs,
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    for (const line of this.lines) {
      await Promise.resolve();
      this.delivered += 1;
      yield line;
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the double throws any scripted value
    if (this.failAfterLines !== null) throw this.failAfterLines;
  }
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const failureOf = (stream: AsyncIterable<string>): Promise<unknown> =>
  collect(stream).then(
    () => null,
    (e: unknown) => e,
  );

interface StreamFlavor {
  readonly flavor: Flavor;
  readonly flags: readonly string[];
  readonly lines: readonly string[];
  readonly answer: string;
  /** Lines with a final answer and no delta. */
  readonly finalOnly: readonly string[];
  /** Lines that parse but carry no text at all. */
  readonly noText: readonly string[];
  readonly errorLines: readonly string[];
}

const [claudeFlavor, codexFlavor] = flavors as [Flavor, Flavor];
const streamFlavors: StreamFlavor[] = [
  {
    flavor: claudeFlavor,
    flags: CLAUDE_STREAM_FLAGS,
    lines: CLAUDE_STREAM_JSON_LINES,
    answer: '¡Hola! ¿En qué te ayudo?',
    finalOnly: [
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ' Final. ' }),
    ],
    noText: ['{"type":"system","subtype":"init"}'],
    errorLines: [
      JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Not logged in · Please run /login',
      }),
    ],
  },
  {
    flavor: codexFlavor,
    flags: CODEX_STREAM_FLAGS,
    lines: CODEX_EXEC_JSON_LINES,
    answer: '¡Hola! ¿Cómo estás hoy, amigo?',
    finalOnly: [
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'x', type: 'agent_message', text: 'Final.' },
      }),
    ],
    noText: ['{"type":"turn.completed"}'],
    errorLines: [
      JSON.stringify({ type: 'turn.failed', error: { message: 'Error: not logged in' } }),
    ],
  },
];

for (const { flavor: f, flags, lines, answer, finalOnly, noText, errorLines } of streamFlavors) {
  const make = (runner: FakeLineRunner): SummaryProvider => f.make(runner);

  describe(`${f.name} streaming`, () => {
    it('streams several chunks with the stream flags, prompt on stdin, joined to the answer', async () => {
      const runner = new FakeLineRunner();
      runner.lines = lines;
      const seenAt: number[] = [];
      const chunks: string[] = [];
      for await (const chunk of make(runner).streamPrompt('Say hi', cancel())) {
        chunks.push(chunk);
        seenAt.push(runner.delivered);
      }
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(answer);
      // The first chunk arrives before the last line: it streams, it does not wait for the end.
      expect(seenAt[0]).toBeLessThan(lines.length);
      expect(runner.calls).toEqual([]);
      expect(runner.lineCalls).toEqual([
        {
          executable: f.executable,
          args: [...f.plainArgs, ...flags],
          stdin: 'Say hi',
          timeoutMs: CLI_TIMEOUT_MS,
        },
      ]);
    });

    it('keeps model, effort and web search in streaming mode', async () => {
      const runner = new FakeLineRunner();
      runner.lines = lines;
      await collect(f.makeWeb(runner).streamPrompt('p', cancel()));
      const args = runner.lineCalls[0]?.args ?? [];
      expect(args).toContain(f.id === 'codex' ? '--search' : '--allowedTools');
      expect(args.slice(-flags.length)).toEqual(flags);
      const configured = new FakeLineRunner();
      configured.lines = lines;
      const [model] = f.configuredArgs.filter((a) => a === 'sonnet' || a === 'gpt-5.6');
      await collect(f.makeWith(configured, model ?? '', 'low').streamPrompt('p', cancel()));
      expect(configured.lineCalls[0]?.args).toEqual([...f.configuredArgs, ...flags]);
    });

    it('completePrompt still runs the one-shot command (summaries unchanged)', async () => {
      const runner = new FakeLineRunner('  whole \n');
      expect(await make(runner).completePrompt('p', cancel())).toBe('whole');
      expect(runner.lineCalls).toEqual([]);
      expect(runner.calls[0]?.args).toEqual(f.plainArgs);
    });

    it('falls back to the final answer when no delta arrived', async () => {
      const runner = new FakeLineRunner();
      runner.lines = finalOnly;
      expect(await collect(make(runner).streamPrompt('p', cancel()))).toEqual(['Final.']);
    });

    it('falls back to the plain stdout when nothing parses as JSON', async () => {
      const runner = new FakeLineRunner();
      runner.lines = ['  plain answer', 'second line  '];
      const chunks = await collect(make(runner).streamPrompt('p', cancel()));
      expect(chunks).toEqual(['plain answer\nsecond line']);
    });

    it('is EmptyOutput when the stream parsed but held no text', async () => {
      const runner = new FakeLineRunner();
      runner.lines = noText;
      const error = await failureOf(make(runner).streamPrompt('p', cancel()));
      expect((error as CliToolError).kind).toBe('EmptyOutput');
    });

    it('classifies an error event from the stream', async () => {
      const runner = new FakeLineRunner();
      runner.lines = errorLines;
      runner.failAfterLines = new CliExitError(f.executable, 1, '');
      const error = await failureOf(make(runner).streamPrompt('p', cancel()));
      expect(error).toBeInstanceOf(CliToolError);
      expect((error as CliToolError).kind).toBe('NotSignedIn');
      expect((error as CliToolError).displayName).toBe(f.displayName);
    });

    it('classifies a non-zero exit from its stderr tail', async () => {
      const runner = new FakeLineRunner();
      runner.failAfterLines = new CliExitError(f.executable, 2, 'Error: not logged in');
      const error = await failureOf(make(runner).streamPrompt('p', cancel()));
      expect((error as CliToolError).kind).toBe('NotSignedIn');
    });

    it('maps a timeout to TimedOut and never wraps a cancellation', async () => {
      const timed = new FakeLineRunner();
      timed.failAfterLines = new CliTimeoutError();
      const error = await failureOf(make(timed).streamPrompt('p', cancel()));
      expect((error as CliToolError).kind).toBe('TimedOut');
      const stopped = new FakeLineRunner();
      stopped.failAfterLines = new CancelledError();
      const cancelled = await failureOf(make(stopped).streamPrompt('p', cancel()));
      expect(isCancellation(cancelled)).toBe(true);
      expect(cancelled).not.toBeInstanceOf(CliToolError);
    });

    it('is NotInstalled before any spawn, and refuses an unsafe model first', async () => {
      const missing = new FakeLineRunner();
      missing.onPath = false;
      const error = await failureOf(make(missing).streamPrompt('p', cancel()));
      expect((error as CliToolError).kind).toBe('NotInstalled');
      expect(missing.lineCalls).toEqual([]);
      const unsafe = new FakeLineRunner();
      const refused = await failureOf(
        f.makeWith(unsafe, 'a b; rm', 'low').streamPrompt('p', cancel()),
      );
      expect(refused).toBeInstanceOf(InvalidCliOptionError);
      expect(unsafe.lineCalls).toEqual([]);
    });
  });
}

describe('CLI streaming without a line runner', () => {
  it('keeps the one-chunk path for a runner that cannot stream lines', async () => {
    const runner = new FakeCliProcessRunner(' whole ');
    const chunks = await collect(createClaudeCodeProvider(runner).streamPrompt('p', cancel()));
    expect(chunks).toEqual(['whole']);
    expect(runner.calls[0]?.args).toEqual(['-p', ...CLAUDE_LEAN_FLAGS]);
  });

  const images: CliPromptOptions = {
    images: {
      directory: 'C:/Users/andres/AppData/Local/Temp/vz-1',
      paths: ['C:/Users/andres/AppData/Local/Temp/vz-1/image-1.png'],
    },
  };

  it('Claude keeps the attached images on the one-chunk path', async () => {
    const runner = new FakeCliProcessRunner('seen');
    const chunks = await collect(
      createClaudeCodeProvider(runner).streamPrompt('p', cancel(), images),
    );
    expect(chunks).toEqual(['seen']);
    expect(runner.calls[0]?.cwd).toBe('C:/Users/andres/AppData/Local/Temp/vz-1');
    expect(runner.calls[0]?.args).toEqual([
      '-p',
      ...CLAUDE_LEAN_FLAGS,
      ...claudeImageArgs('C:/Users/andres/AppData/Local/Temp/vz-1'),
    ]);
  });

  it('Codex keeps the attached images on the one-chunk path', async () => {
    const runner = new FakeCliProcessRunner('seen');
    await collect(createCodexProvider(runner).streamPrompt('p', cancel(), images));
    expect(runner.calls[0]?.cwd).toBeUndefined();
    expect(runner.calls[0]?.args.slice(-2)).toEqual([
      '-i',
      'C:/Users/andres/AppData/Local/Temp/vz-1/image-1.png',
    ]);
  });

  it('summaries never carry images or another working folder', async () => {
    const runner = new FakeCliProcessRunner('whole');
    await createClaudeCodeProvider(runner).completePrompt('p', cancel());
    expect(runner.calls[0]?.cwd).toBeUndefined();
    expect(runner.calls[0]?.args).toEqual(['-p', ...CLAUDE_LEAN_FLAGS]);
  });
});

describe('CLI streaming with attached images', () => {
  const images: CliPromptOptions = {
    images: {
      directory: 'C:/Users/andres/AppData/Local/Temp/vz-1',
      paths: ['C:/Users/andres/AppData/Local/Temp/vz-1/image-1.png'],
    },
  };

  it('Claude runs in the image folder with only the Read tool, over that folder', async () => {
    const runner = new FakeLineRunner();
    runner.lines = CLAUDE_STREAM_JSON_LINES;
    await collect(createClaudeCodeProvider(runner).streamPrompt('p', cancel(), images));
    expect(runner.lineCalls[0]?.cwd).toBe('C:/Users/andres/AppData/Local/Temp/vz-1');
    expect(runner.lineCalls[0]?.args).toEqual([
      '-p',
      ...CLAUDE_LEAN_FLAGS,
      ...CLAUDE_STREAM_FLAGS,
      ...claudeImageArgs('C:/Users/andres/AppData/Local/Temp/vz-1'),
    ]);
  });

  it('Codex gets one -i per image and keeps its working folder', async () => {
    const runner = new FakeLineRunner();
    runner.lines = CODEX_EXEC_JSON_LINES;
    await collect(createCodexProvider(runner).streamPrompt('p', cancel(), images));
    expect(runner.lineCalls[0]?.cwd).toBeUndefined();
    expect(runner.lineCalls[0]?.args.slice(-2)).toEqual(
      codexImageArgs(['C:/Users/andres/AppData/Local/Temp/vz-1/image-1.png']),
    );
  });

  it('Codex reads images from a folder with a comma by name, run in that folder', async () => {
    const runner = new FakeLineRunner();
    runner.lines = CODEX_EXEC_JSON_LINES;
    const comma: CliPromptOptions = {
      images: {
        directory: 'C:\\Users\\Smith, John\\AppData\\Local\\Temp\\vz-1',
        paths: [
          'C:\\Users\\Smith, John\\AppData\\Local\\Temp\\vz-1\\image-1.png',
          'C:\\Users\\Smith, John\\AppData\\Local\\Temp\\vz-1\\shot (2).jpg',
        ],
      },
    };
    await collect(createCodexProvider(runner).streamPrompt('p', cancel(), comma));
    expect(runner.lineCalls[0]?.cwd).toBe('C:\\Users\\Smith, John\\AppData\\Local\\Temp\\vz-1');
    expect(runner.lineCalls[0]?.args.slice(-4)).toEqual([
      '-i',
      'image-1.png',
      '-i',
      'shot (2).jpg',
    ]);
  });

  it('without images nothing changes', async () => {
    const runner = new FakeLineRunner();
    runner.lines = CLAUDE_STREAM_JSON_LINES;
    await collect(createClaudeCodeProvider(runner).streamPrompt('p', cancel(), {}));
    expect(runner.lineCalls[0]?.cwd).toBeUndefined();
    expect(runner.lineCalls[0]?.args).toEqual(['-p', ...CLAUDE_LEAN_FLAGS, ...CLAUDE_STREAM_FLAGS]);
  });
});
