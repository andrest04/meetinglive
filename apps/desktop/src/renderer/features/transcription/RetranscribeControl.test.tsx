// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { RetranscribeButton, RetranscribeStatus } from './RetranscribeControl';
import { installTranscriptionApi } from './transcription-test-kit';
import { useRetranscription } from './use-retranscription';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const idle = { isRunning: false, meetingId: null, status: '', lastResults: [] };

interface HarnessProps {
  hasAudio?: boolean;
  onFinished?: () => void;
  onAudioChanged?: () => void;
}

function Harness({ hasAudio = true, onFinished, onAudioChanged }: HarnessProps) {
  const model = useRetranscription('m1', { onFinished, onAudioChanged });
  return (
    <>
      <RetranscribeButton model={model} meetingTitle="Weekly sync" hasAudio={hasAudio} />
      <RetranscribeStatus model={model} />
    </>
  );
}

const mount = (props: HarnessProps = {}) =>
  render(
    <Providers>
      <Harness {...props} />
    </Providers>,
  );

const button = () => screen.findByRole('button', { name: 'Re-transcribe' });

const available = {
  'retranscription.availability': () => ({ availability: 'Available' }),
  'retranscription.getState': () => idle,
};

describe('Re-transcribe in the session header', () => {
  it('is not drawn when the meeting has no saved audio (item 89)', async () => {
    installTranscriptionApi(available);
    mount({ hasAudio: false });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Re-transcribe' })).toBeNull();
    });
  });

  it('asks first, naming the meeting, warns about the summary, and starts only on confirm (96 to 98)', async () => {
    const api = installTranscriptionApi({
      ...available,
      'retranscription.start': () => ({ started: true, reason: null }),
    });
    mount();
    await waitFor(async () => {
      expect(await button()).toBeEnabled();
    });
    await userEvent.click(await button());
    const dialog = await screen.findByRole('dialog', { name: 'Re-transcribe this meeting?' });
    expect(dialog).toHaveTextContent('Re-transcribing "Weekly sync" replaces its transcript');
    expect(dialog).toHaveTextContent('Any edits to the current summary will be lost.');
    expect(api.calls.some((c) => c.name === 'retranscription.start')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Re-transcribe' }));
    await waitFor(() => {
      expect(api.calls.find((c) => c.name === 'retranscription.start')?.input).toEqual({
        meetingId: 'm1',
      });
    });
  });

  it('puts the safe Cancel button in focus and does nothing when it is chosen (97, 99)', async () => {
    const api = installTranscriptionApi(available);
    mount();
    await waitFor(async () => {
      expect(await button()).toBeEnabled();
    });
    await userEvent.click(await button());
    const dialog = await screen.findByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => {
      expect(cancel).toHaveFocus();
    });
    await userEvent.click(cancel);
    expect(api.calls.some((c) => c.name === 'retranscription.start')).toBe(false);
  });

  it('asks again on click and shows no dialog when the audio is gone (96, 100)', async () => {
    let answer = 'Available';
    const changed = vi.fn();
    const api = installTranscriptionApi({
      ...available,
      'retranscription.availability': () => ({ availability: answer }),
    });
    mount({ onAudioChanged: changed });
    await waitFor(async () => {
      expect(await button()).toBeEnabled();
    });
    answer = 'NoAudio';
    await userEvent.click(await button());
    await waitFor(() => {
      expect(changed).toHaveBeenCalled();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls.some((c) => c.name === 'retranscription.start')).toBe(false);
  });

  it('starts nothing when the audio vanished after the confirmation (100)', async () => {
    let answer = 'Available';
    const changed = vi.fn();
    const api = installTranscriptionApi({
      ...available,
      'retranscription.availability': () => ({ availability: answer }),
    });
    mount({ onAudioChanged: changed });
    await waitFor(async () => {
      expect(await button()).toBeEnabled();
    });
    await userEvent.click(await button());
    const dialog = await screen.findByRole('dialog');
    answer = 'NoAudio';
    await userEvent.click(within(dialog).getByRole('button', { name: 'Re-transcribe' }));
    await waitFor(() => {
      expect(changed).toHaveBeenCalled();
    });
    expect(api.calls.some((c) => c.name === 'retranscription.start')).toBe(false);
  });

  it('clears the previous outcome when a new run starts (101)', async () => {
    const api = installTranscriptionApi({
      ...available,
      'retranscription.start': () => ({ started: true, reason: null }),
    });
    mount();
    await button();
    api.emit('retranscription.finished', { meetingId: 'm1', outcome: 'Failed', message: 'boom' });
    expect(await screen.findByText('boom')).toBeVisible();
    await userEvent.click(await button());
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Re-transcribe' }));
    await waitFor(() => {
      expect(screen.queryByText('boom')).toBeNull();
    });
  });

  it('is disabled with the reason when another run or a recording is busy (90, 91, B16)', async () => {
    installTranscriptionApi({
      'retranscription.availability': () => ({ availability: 'Busy' }),
      'retranscription.getState': () => idle,
    });
    mount();
    expect(
      await screen.findByText('Wait for the current recording or re-transcription to finish.'),
    ).toBeVisible();
    expect(await button()).toBeDisabled();
  });

  it('points to the engine download when the engine is missing', async () => {
    installTranscriptionApi({
      ...available,
      'transcription.getStatus': () => ({ ready: false }),
    });
    mount();
    expect(
      await screen.findByText('The transcription engine is not installed yet. Download it first.'),
    ).toBeVisible();
  });
});

describe('progress and outcome rows', () => {
  it('shows a polite status, an indeterminate named bar and Cancel, only for this meeting (134 to 137)', async () => {
    const api = installTranscriptionApi(available);
    mount();
    await button();
    api.emit('retranscription.stateChanged', {
      isRunning: true,
      meetingId: 'other',
      status: 'Transcribing audio... 7%',
    });
    expect(screen.queryByTestId('TextSessionRetranscribeStatus')).toBeNull();

    api.emit('retranscription.stateChanged', {
      isRunning: true,
      meetingId: 'm1',
      status: 'Transcribing audio... 42%',
    });
    const status = await screen.findByTestId('TextSessionRetranscribeStatus');
    expect(status).toHaveTextContent('Transcribing audio... 42%');
    expect(status).toHaveAttribute('aria-live', 'polite');
    const bar = screen.getByTestId('ProgressSessionRetranscribe');
    expect(bar).toHaveAccessibleName('Re-transcription progress');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('button', { name: 'Re-transcribe' })).toBeDisabled();

    const cancel = screen.getByTestId('BtnSessionRetranscribeCancel');
    expect(cancel).toHaveAccessibleName('Cancel re-transcription');
    await userEvent.click(cancel);
    expect(api.calls.some((c) => c.name === 'retranscription.cancel')).toBe(true);
  });

  it('falls back to the localized transcribing status when the runner status is empty', async () => {
    const api = installTranscriptionApi(available);
    mount();
    await button();
    api.emit('retranscription.stateChanged', { isRunning: true, meetingId: 'm1', status: '' });
    expect(await screen.findByTestId('TextSessionRetranscribeStatus')).toHaveTextContent(
      'Transcribing audio...',
    );
  });

  it.each([
    [
      'Completed',
      null,
      'InfoSessionRetranscribeNotice',
      'Re-transcribed. The transcript and summary were updated.',
    ],
    [
      'TranscriptOnly',
      null,
      'InfoSessionRetranscribeNotice',
      'Re-transcribed. The transcript was updated, but no summary was generated.',
    ],
    ['Cancelled', null, 'InfoSessionRetranscribeNotice', 'Re-transcription cancelled.'],
    [
      'SummaryFailed',
      'quota',
      'InfoSessionRetranscribeError',
      'Transcript saved. Summary failed: quota',
    ],
    [
      'Failed',
      'No transcript was produced.',
      'InfoSessionRetranscribeError',
      'No transcript was produced.',
    ],
  ])('reports the outcome %s in the right bar (139 to 142)', async (outcome, message, id, text) => {
    const api = installTranscriptionApi(available);
    const finished = vi.fn();
    mount({ onFinished: finished });
    await button();
    api.emit('retranscription.finished', { meetingId: 'm1', outcome, message });
    const bar = await screen.findByTestId(id);
    expect(bar).toHaveTextContent(text);
    expect(bar).toHaveTextContent(
      id === 'InfoSessionRetranscribeError' ? 'Re-transcription failed' : 'Re-transcription',
    );
    // 143: the page reloads its tabs after every outcome.
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('ignores a run that finished for another meeting (138)', async () => {
    const api = installTranscriptionApi(available);
    const finished = vi.fn();
    mount({ onFinished: finished });
    await button();
    api.emit('retranscription.finished', {
      meetingId: 'other',
      outcome: 'Completed',
      message: null,
    });
    expect(screen.queryByText(/Re-transcribed\./)).toBeNull();
    expect(finished).not.toHaveBeenCalled();
  });

  it('keeps the bar until it is dismissed, and then lets main forget it (144)', async () => {
    const api = installTranscriptionApi(available);
    mount();
    await button();
    api.emit('retranscription.finished', { meetingId: 'm1', outcome: 'Completed', message: null });
    const bar = await screen.findByTestId('InfoSessionRetranscribeNotice');
    await userEvent.click(within(bar).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('InfoSessionRetranscribeNotice')).toBeNull();
    expect(api.calls.filter((c) => c.name === 'retranscription.dismiss').length).toBeGreaterThan(0);
  });

  it('shows the result kept from a run that ended while the page was elsewhere (B7)', async () => {
    const api = installTranscriptionApi({
      ...available,
      'retranscription.getState': () => ({
        ...idle,
        lastResults: [
          { meetingId: 'other', outcome: 'Failed', message: 'not mine' },
          { meetingId: 'm1', outcome: 'Cancelled', message: null },
        ],
      }),
    });
    mount();
    expect(await screen.findByTestId('InfoSessionRetranscribeNotice')).toHaveTextContent(
      'Re-transcription cancelled.',
    );
    expect(screen.queryByText('not mine')).toBeNull();
    await waitFor(() => {
      expect(api.calls.find((c) => c.name === 'retranscription.dismiss')?.input).toEqual({
        meetingId: 'm1',
      });
    });
  });
});
