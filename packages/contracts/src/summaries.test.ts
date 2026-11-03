import { describe, expect, it } from 'vitest';
import {
  eventChannels,
  generateOutcomeSchema,
  requestChannels,
  summariesCheckCli,
  summariesChooseCli,
  summariesChooseLocalModel,
  summariesGenerate,
  summariesHardware,
  summariesLoadTab,
  summariesProgress,
  summariesProviderStatus,
  summariesToggleAction,
} from './index';

describe('summaries contracts', () => {
  it('registers every request and the progress event by name', () => {
    for (const name of [
      'summaries.loadTab',
      'summaries.generate',
      'summaries.cancel',
      'summaries.saveNotes',
      'summaries.toggleAction',
      'summaries.copyActions',
      'summaries.setTemplate',
      'summaries.providerStatus',
      'summaries.hardware',
      'summaries.checkCli',
      'summaries.chooseLocalModel',
      'summaries.cancelLocalModel',
      'summaries.chooseCli',
    ]) {
      expect(Object.keys(requestChannels)).toContain(name);
    }
    expect(Object.keys(eventChannels)).toContain('summaries.progress');
  });

  it('every generate outcome is a value the schema accepts', () => {
    const outcomes: unknown[] = [
      {
        status: 'generated',
        title: 'T',
        titleChanged: false,
        summary: 's',
        actionItems: [{ text: 'a', isDone: false }],
        providerId: 'codex',
      },
      { status: 'no-transcript' },
      { status: 'not-found' },
      { status: 'busy' },
      { status: 'needs-setup', kind: 'Local', reason: 'model-missing' },
      { status: 'unavailable', reason: 'xai-removed' },
      { status: 'cancelled' },
      { status: 'failed', code: 'CliNotSignedIn', args: ['Codex', 2], detail: null, message: 'm' },
    ];
    for (const outcome of outcomes) {
      expect(generateOutcomeSchema.safeParse(outcome).success).toBe(true);
    }
    expect(generateOutcomeSchema.safeParse({ status: 'xai' }).success).toBe(false);
    expect(generateOutcomeSchema.safeParse({ status: 'failed', code: 'x' }).success).toBe(false);
  });

  it('refuses malformed input', () => {
    expect(summariesGenerate.input.safeParse({ meetingId: '', regenerate: false }).success).toBe(
      false,
    );
    expect(summariesGenerate.input.safeParse({ meetingId: 'a', regenerate: 'yes' }).success).toBe(
      false,
    );
    expect(
      summariesGenerate.input.safeParse({ meetingId: 'a', regenerate: true, templateId: null })
        .success,
    ).toBe(true);
    expect(summariesLoadTab.input.safeParse({ meetingId: null }).success).toBe(true);
    expect(
      summariesToggleAction.input.safeParse({ meetingId: 'a', index: -1, done: true }).success,
    ).toBe(false);
    expect(summariesCheckCli.input.safeParse({ kind: 'Xai' }).success).toBe(false);
    expect(summariesChooseCli.input.safeParse({ kind: 'Local' }).success).toBe(false);
    expect(summariesChooseLocalModel.input.safeParse({ fileName: '' }).success).toBe(false);
    expect(summariesProgress.payload.safeParse({ meetingId: 'a', running: true }).success).toBe(
      true,
    );
  });

  it('the gate answers unavailable for the removed provider, with no kind to set up', () => {
    expect(
      summariesProviderStatus.output.safeParse({ status: 'unavailable', reason: 'xai-removed' })
        .success,
    ).toBe(true);
    expect(
      summariesProviderStatus.output.safeParse({ status: 'needs-setup', kind: 'Xai', reason: 'x' })
        .success,
    ).toBe(false);
  });

  it('the wizard options carry rows and a default', () => {
    const parsed = summariesHardware.output.safeParse({
      hardware: { totalRamGb: 16, gpuName: null, gpuVramGb: null },
      rows: [],
      defaultFileName: null,
    });
    expect(parsed.success).toBe(true);
  });
});
