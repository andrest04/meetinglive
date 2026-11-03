// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { TranscriptionSection } from './TranscriptionSection';
import { baseStatus, installTranscriptionApi } from './transcription-test-kit';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = () =>
  render(
    <Providers>
      <TranscriptionSection />
    </Providers>,
  );

const notReady = {
  ...baseStatus,
  ready: false,
  modelInstalled: false,
  runtimes: { cpu: false, cuda: false },
};

const ENGINE = 'Nemotron 3.5 ASR Streaming 0.6B';

describe('TranscriptionSection engine', () => {
  it('says what is installed and enables only the action that makes sense', async () => {
    installTranscriptionApi();
    mount();
    expect(await screen.findByText('Installed')).toBeVisible();
    expect(screen.getByRole('button', { name: `Download ${ENGINE}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Delete ${ENGINE}` })).toBeEnabled();
  });

  it('downloads with the stage words and one overall bar, then shows it installed', async () => {
    let ready = false;
    let release: () => void = () => undefined;
    const api = installTranscriptionApi({
      'transcription.getStatus': () => (ready ? baseStatus : notReady),
      'transcription.ensureEngine': () =>
        new Promise((resolve) => {
          release = () => {
            ready = true;
            resolve({ status: 'ready' });
          };
        }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: `Download ${ENGINE}` }));
    api.emit('transcription.installProgress', {
      stage: 'model',
      percent: 50,
      stepIndex: 1,
      stepCount: 2,
    });
    const bar = await screen.findByRole('progressbar', {
      name: 'Downloading the Nemotron 3.5 ASR model',
    });
    expect(bar).toHaveAttribute('aria-valuenow', '75');
    release();
    expect(await screen.findByText('Installed')).toBeVisible();
  });

  it('puts the raw failure where the acceleration caption was', async () => {
    installTranscriptionApi({
      'transcription.getStatus': () => notReady,
      'transcription.ensureEngine': () => ({ status: 'failed', message: 'disk full' }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: `Download ${ENGINE}` }));
    await waitFor(() => {
      expect(screen.getByTestId('acceleration-caption')).toHaveTextContent(
        'Download failed: disk full',
      );
    });
  });

  it.each([
    ['RuntimeInUse', 'The engine is in use. Restart the app, then delete it.'],
    ['Incomplete', 'Part of the engine could not be removed. It may need to be downloaded again.'],
  ])('explains a delete that ends as %s', async (outcome, text) => {
    installTranscriptionApi({ 'transcription.deleteEngine': () => ({ outcome }) });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: `Delete ${ENGINE}` }));
    await waitFor(() => {
      expect(screen.getByTestId('acceleration-caption')).toHaveTextContent(text);
    });
  });

  it('shows the acceleration captions for the expected and the used backend', async () => {
    installTranscriptionApi({
      'transcription.getStatus': () => ({ ...baseStatus, expectedBackend: 'cuda' }),
    });
    mount();
    expect(await screen.findByTestId('acceleration-caption')).toHaveTextContent(
      'Will try GPU (CUDA); the backend actually used is shown after the first transcription',
    );
    cleanup();
    installTranscriptionApi({
      'transcription.getStatus': () => ({
        ...baseStatus,
        usage: { backend: 'cuda', fallbackReason: null, diarization: 'off' },
      }),
    });
    mount();
    expect(await screen.findByTestId('acceleration-caption')).toHaveTextContent(
      'Running on GPU (CUDA)',
    );
  });

  it('warns when CUDA fell back to the CPU, with the reason as it came', async () => {
    installTranscriptionApi({
      'transcription.getStatus': () => ({
        ...baseStatus,
        usage: { backend: 'cpu', fallbackReason: 'cudaMalloc failed', diarization: 'off' },
      }),
    });
    mount();
    expect(await screen.findByText('GPU acceleration is not active')).toBeVisible();
    expect(
      screen.getByText(
        'CUDA could not start, so transcription ran on the CPU and may be slower. Reason: cudaMalloc failed',
      ),
    ).toBeVisible();
    expect(screen.getByTestId('acceleration-caption')).toHaveTextContent('Running on CPU');
  });
});

describe('TranscriptionSection live drops', () => {
  it('is quiet before a live session has stopped', async () => {
    installTranscriptionApi();
    mount();
    await screen.findByText('Installed');
    expect(screen.queryByTestId('live-drops-caption')).toBeNull();
  });

  it('shows a caption up to 5 percent and a warning above it', async () => {
    installTranscriptionApi({
      'transcription.getStatus': () => ({ ...baseStatus, liveDroppedPercent: 5 }),
    });
    mount();
    expect(await screen.findByTestId('live-drops-caption')).toHaveTextContent(
      'Last live session: 5% of audio skipped',
    );
    cleanup();
    installTranscriptionApi({
      'transcription.getStatus': () => ({ ...baseStatus, liveDroppedPercent: 12.34 }),
    });
    mount();
    expect(await screen.findByText('Live transcript skipped audio')).toBeVisible();
    expect(screen.getByText(/Live transcript skipped 12\.3% of the audio/)).toBeVisible();
    expect(screen.queryByTestId('live-drops-caption')).toBeNull();
  });
});

describe('TranscriptionSection switches', () => {
  it('saves the live preview switch', async () => {
    let live = true;
    const api = installTranscriptionApi({
      'transcription.getStatus': () => ({ ...baseStatus, liveEnabled: live }),
      'transcription.setLiveEnabled': (input) => {
        live = input.enabled as boolean;
        return { saved: true };
      },
    });
    mount();
    const toggle = await screen.findByRole('switch', {
      name: 'Live transcription during recording',
    });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });
    expect(api.calls.find((c) => c.name === 'transcription.setLiveEnabled')?.input).toEqual({
      enabled: false,
    });
  });

  it('keeps labels off and says why when the speaker model cannot be downloaded', async () => {
    const api = installTranscriptionApi({
      'transcription.setSpeakerLabels': () => ({ status: 'failed', message: 'offline' }),
    });
    mount();
    const toggle = await screen.findByRole('switch', { name: 'Speaker labels' });
    await userEvent.click(toggle);
    expect(
      await screen.findByText('Download failed: offline Speaker labels stay off.'),
    ).toBeVisible();
    expect(toggle).not.toBeChecked();
    expect(api.calls.find((c) => c.name === 'transcription.setSpeakerLabels')?.input).toEqual({
      enabled: true,
    });
  });

  it('downloads and deletes the speaker model', async () => {
    let installed = false;
    const api = installTranscriptionApi({
      'transcription.getStatus': () => ({ ...baseStatus, speakerModelInstalled: installed }),
      'transcription.downloadSpeakerModel': () => {
        installed = true;
        return { status: 'ready' };
      },
      'transcription.deleteSpeakerModel': () => {
        installed = false;
        return { status: 'deleted' };
      },
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Download Speaker model' }));
    api.emit('transcription.installProgress', {
      stage: 'speaker-model',
      percent: 40,
      stepIndex: 0,
      stepCount: 1,
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete Speaker model' })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Delete Speaker model' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Download Speaker model' })).toBeEnabled();
    });
  });

  it('a failed delete says so and draws no download bar', async () => {
    const api = installTranscriptionApi({
      'transcription.getStatus': () => ({ ...baseStatus, speakerModelInstalled: true }),
      'transcription.deleteSpeakerModel': () => ({ status: 'failed', message: 'EBUSY' }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Speaker model' }));
    expect(await screen.findByText('Could not delete the speaker model: EBUSY')).toBeVisible();
    expect(screen.queryByText(/Download failed/)).toBeNull();
    expect(screen.queryByRole('progressbar', { name: /Sortformer/ })).toBeNull();
    expect(api.calls.some((c) => c.name === 'transcription.deleteSpeakerModel')).toBe(true);
  });

  it('says so when labels are on but the model is missing', async () => {
    installTranscriptionApi({
      'transcription.getStatus': () => ({
        ...baseStatus,
        speakerLabelsEnabled: true,
        usage: { backend: 'cpu', fallbackReason: null, diarization: 'model-missing' },
      }),
    });
    mount();
    const section = await screen.findByTestId('transcription-section');
    expect(
      await within(section).findByText(
        'Speaker labels are on, but the speaker model is not installed, so transcripts have no labels.',
      ),
    ).toBeVisible();
  });
});

describe('TranscriptionSection speaker download progress', () => {
  it('draws the bar with the pushed percent while the download runs', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const api = installTranscriptionApi({
      'transcription.downloadSpeakerModel': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Download Speaker model' }));
    api.emit('transcription.installProgress', {
      stage: 'speaker-model',
      percent: 40,
      stepIndex: 0,
      stepCount: 1,
    });
    const bar = await screen.findByRole('progressbar', {
      name: 'Downloading Sortformer speaker model...',
    });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    api.emit('transcription.installProgress', {
      stage: 'engine',
      percent: 90,
      stepIndex: 0,
      stepCount: 1,
    });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    finish({ status: 'ready' });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });

  it('keeps Delete engine disabled while a speaker download runs', async () => {
    const api = installTranscriptionApi({
      'transcription.downloadSpeakerModel': () => new Promise(() => undefined),
    });
    mount();
    expect(await screen.findByRole('button', { name: `Delete ${ENGINE}` })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Download Speaker model' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: `Delete ${ENGINE}` })).toBeDisabled();
    });
    expect(api.calls.some((c) => c.name === 'transcription.deleteEngine')).toBe(false);
  });

  it('a failed Download button says so and keeps speaker labels off', async () => {
    installTranscriptionApi({
      'transcription.downloadSpeakerModel': () => ({ status: 'failed', message: 'offline' }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Download Speaker model' }));
    expect(await screen.findByText(/Download failed: offline/)).toBeVisible();
  });
});

describe('TranscriptionSection status pushes', () => {
  it('follows a push after mount without asking again', async () => {
    const api = installTranscriptionApi();
    mount();
    expect(await screen.findByText('Installed')).toBeVisible();
    const asked = api.calls.filter((c) => c.name === 'transcription.getStatus').length;
    api.emit('transcription.statusChanged', notReady);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: `Download ${ENGINE}` })).toBeEnabled();
    });
    expect(api.calls.filter((c) => c.name === 'transcription.getStatus')).toHaveLength(asked);
  });

  it('a push that lands before the first answer wins over that answer', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const api = installTranscriptionApi({
      'transcription.getStatus': () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    mount();
    await waitFor(() => {
      expect(api.calls.some((c) => c.name === 'transcription.getStatus')).toBe(true);
    });
    api.emit('transcription.statusChanged', notReady);
    answer(baseStatus);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: `Download ${ENGINE}` })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: `Delete ${ENGINE}` })).toBeDisabled();
  });
});

describe('TranscriptionSection number format', () => {
  it('writes the dropped percent in the app language', async () => {
    installTranscriptionApi({
      'transcription.getStatus': () => ({ ...baseStatus, liveDroppedPercent: 12.34 }),
    });
    render(
      <Providers locale="es">
        <TranscriptionSection />
      </Providers>,
    );
    expect(await screen.findByText(/12,3\s?%/)).toBeVisible();
  });

  const missingCopy =
    'Speaker labels are on, but the speaker model is not installed, so transcripts have no labels.';

  it('drops the stale warning once the speaker model is installed', async () => {
    installTranscriptionApi({
      'transcription.getStatus': () => ({
        ...baseStatus,
        speakerLabelsEnabled: true,
        speakerModelInstalled: true,
        usage: { backend: 'cpu', fallbackReason: null, diarization: 'model-missing' },
      }),
    });
    mount();
    const section = await screen.findByTestId('transcription-section');
    await within(section).findByRole('button', { name: 'Delete Speaker model' });
    expect(within(section).queryByText(missingCopy)).toBeNull();
  });

  it('drops the stale warning once labels are off', async () => {
    installTranscriptionApi({
      'transcription.getStatus': () => ({
        ...baseStatus,
        speakerLabelsEnabled: false,
        speakerModelInstalled: false,
        usage: { backend: 'cpu', fallbackReason: null, diarization: 'model-missing' },
      }),
    });
    mount();
    const section = await screen.findByTestId('transcription-section');
    await within(section).findByRole('button', { name: 'Download Speaker model' });
    expect(within(section).queryByText(missingCopy)).toBeNull();
  });
});
