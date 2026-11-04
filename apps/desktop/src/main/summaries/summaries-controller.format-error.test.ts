import { CliToolError, type TranslateFn } from '@vozella/core';
import { describe, expect, it } from 'vitest';
import { SummariesController, type SummariesControllerDeps } from './summaries-controller';

const t: TranslateFn = (key, ...args) =>
  args.length === 0 ? key : `${key}:${args.map(String).join(',')}`;

/** `formatError` only reads `t`; the other ports are never touched. */
const controller = (): SummariesController =>
  new SummariesController({ t } as unknown as SummariesControllerDeps);

describe('SummariesController.formatError (the live ask failure sentence)', () => {
  it('maps a CLI failure to its localized message with the tool name', () => {
    expect(controller().formatError(new CliToolError('Claude Code', 'NotSignedIn'))).toBe(
      'Error_CliNotSignedIn:Claude Code',
    );
    expect(controller().formatError(new CliToolError('Codex', 'TimedOut'))).toBe(
      'Error_CliTimedOut:Codex',
    );
  });

  it('keeps the detail of an unknown CLI failure', () => {
    expect(controller().formatError(new CliToolError('Codex', 'Unknown', 'exit 7'))).toBe(
      'Error_CliUnknown:Codex exit 7',
    );
  });

  it('maps any other error to its message, and a non-error to its text', () => {
    expect(controller().formatError(new Error('disk is full'))).toBe('disk is full');
    expect(controller().formatError('plain')).toBe('plain');
  });
});
