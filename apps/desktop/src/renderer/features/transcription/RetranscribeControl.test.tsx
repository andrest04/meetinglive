// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { RetranscribeControl } from './RetranscribeControl';
import { installTranscriptionApi } from './transcription-test-kit';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const idle = { isRunning: false, meetingId: null, status: '' };

const mount = () =>
  render(
    <Providers>
      <RetranscribeControl meetingId="m1" meetingTitle="Weekly sync" />
    </Providers>,
  );

const button = () => screen.findByRole('button', { name: 'Re-transcribe' });

describe('RetranscribeControl', () => {
  it('asks first, naming the meeting, and starts only on confirm', async () => {
    const api = installTranscriptionApi({
      'retranscription.availability': () => ({ availability: 'Available' }),
      'retranscription.getState': () => idle,
      'retranscription.start': () => ({ started: true, reason: null }),
    });
    mount();
    await waitFor(async () => {
      expect(await button()).toBeEnabled();
    });
    await userEvent.click(await button());
    const dialog = await screen.findByRole('dialog', { name: 'Re-transcribe this meeting?' });
    expect(dialog).toHaveTextContent('Re-transcribing "Weekly sync" replaces its transcript');
    expect(api.calls.some((c) => c.name === 'retranscription.start')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Re-transcribe' }));
    await waitFor(() => {
      expect(api.calls.find((c) => c.name === 'retranscription.start')?.input).toEqual({
        meetingId: 'm1',
      });
    });
  });

  it('does not start when the confirmation is cancelled', async () => {
    const api = installTranscriptionApi({
      'retranscription.availability': () => ({ availability: 'Available' }),
      'retranscription.getState': () => idle,
    });
    mount();
    await waitFor(async () => {
      expect(await button()).toBeEnabled();
    });
    await userEvent.click(await button());
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.calls.some((c) => c.name === 'retranscription.start')).toBe(false);
  });

  it.each([
    ['NoAudio', 'This meeting has no saved audio, so it cannot be re-transcribed.'],
    ['Busy', 'Wait for the current recording or re-transcription to finish.'],
  ])('is disabled with the reason when %s', async (availability, text) => {
    installTranscriptionApi({
      'retranscription.availability': () => ({ availability }),
      'retranscription.getState': () => idle,
    });
    mount();
    expect(await screen.findByText(text)).toBeVisible();
    expect(await button()).toBeDisabled();
  });

  it('points to the engine download when the engine is missing', async () => {
    installTranscriptionApi({
      'transcription.getStatus': () => ({ ready: false }),
      'retranscription.availability': () => ({ availability: 'Available' }),
      'retranscription.getState': () => idle,
    });
    mount();
    expect(
      await screen.findByText('The transcription engine is not installed yet. Download it first.'),
    ).toBeVisible();
  });

  it('shows the percent while it runs, cancels, and tells how it ended', async () => {
    const api = installTranscriptionApi({
      'retranscription.availability': () => ({ availability: 'Available' }),
      'retranscription.getState': () => idle,
    });
    mount();
    await screen.findByRole('button', { name: 'Re-transcribe' });
    api.emit('retranscription.stateChanged', {
      isRunning: true,
      meetingId: 'm1',
      status: 'Transcribing audio... 42%',
    });
    const progress = await screen.findByRole('progressbar', {
      name: 'Transcribing audio... 42%',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByRole('button', { name: 'Re-transcribe' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel re-transcription' }));
    expect(api.calls.some((c) => c.name === 'retranscription.cancel')).toBe(true);

    api.emit('retranscription.stateChanged', idle);
    api.emit('retranscription.finished', { meetingId: 'm1', outcome: 'Cancelled', message: null });
    expect(await screen.findByText('Re-transcription cancelled.')).toBeVisible();
  });

  it.each([
    ['Completed', null, 'Re-transcribed. The transcript and summary were updated.'],
    [
      'TranscriptOnly',
      null,
      'Re-transcribed. The transcript was updated, but no summary was generated.',
    ],
    ['SummaryFailed', 'quota', 'Transcript saved. Summary failed: quota'],
    ['Failed', 'No transcript was produced.', 'No transcript was produced.'],
  ])('reports the outcome %s', async (outcome, message, text) => {
    const api = installTranscriptionApi({
      'retranscription.availability': () => ({ availability: 'Available' }),
      'retranscription.getState': () => idle,
    });
    mount();
    await screen.findByRole('button', { name: 'Re-transcribe' });
    api.emit('retranscription.finished', { meetingId: 'm1', outcome, message });
    expect(await screen.findByText(text)).toBeVisible();
  });

  it('ignores a run that finished for another meeting', async () => {
    const api = installTranscriptionApi({
      'retranscription.availability': () => ({ availability: 'Available' }),
      'retranscription.getState': () => idle,
    });
    mount();
    await screen.findByRole('button', { name: 'Re-transcribe' });
    api.emit('retranscription.finished', {
      meetingId: 'other',
      outcome: 'Completed',
      message: null,
    });
    expect(screen.queryByText(/Re-transcribed\./)).toBeNull();
  });
});
