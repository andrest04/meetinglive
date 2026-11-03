// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { EngineSetupDialog } from './EngineSetupDialog';
import { installTranscriptionApi } from './transcription-test-kit';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('EngineSetupDialog', () => {
  it('starts by itself, shows the step and the overall bar, and closes ready', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const api = installTranscriptionApi({
      'transcription.ensureEngine': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const onFinished = vi.fn();
    render(
      <Providers>
        <EngineSetupDialog open onFinished={onFinished} />
      </Providers>,
    );
    expect(await screen.findByText('Preparing download...')).toBeVisible();
    api.emit('transcription.installProgress', {
      stage: 'runtime-cpu',
      percent: 50,
      stepIndex: 0,
      stepCount: 2,
    });
    expect(await screen.findByText('Downloading the NVIDIA CPU runtime')).toBeVisible();
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    finish({ status: 'ready' });
    await vi.waitFor(() => {
      expect(onFinished).toHaveBeenCalledWith(true);
    });
  });

  it('reports a cancel once, and a late cancelled answer cannot close a dialog opened again', async () => {
    const answers: ((value: unknown) => void)[] = [];
    installTranscriptionApi({
      'transcription.ensureEngine': () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    });
    const onFinished = vi.fn();
    const view = render(
      <Providers>
        <EngineSetupDialog open onFinished={onFinished} />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenLastCalledWith(false);

    view.rerender(
      <Providers>
        <EngineSetupDialog open={false} onFinished={onFinished} />
      </Providers>,
    );
    view.rerender(
      <Providers>
        <EngineSetupDialog open onFinished={onFinished} />
      </Providers>,
    );
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    answers[0]?.({ status: 'cancelled' });
    answers[1]?.({ status: 'ready' });
    await vi.waitFor(() => {
      expect(onFinished).toHaveBeenLastCalledWith(true);
    });
    expect(onFinished).toHaveBeenCalledTimes(2);
  });
});
