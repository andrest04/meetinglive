// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { LiveTranscript } from './LiveTranscript';
import { installTranscriptionApi } from './transcription-test-kit';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = (loading = false) =>
  render(
    <Providers>
      <LiveTranscript loading={loading} />
    </Providers>,
  );

describe('LiveTranscript', () => {
  it('says the model is loading, then that it is listening', () => {
    installTranscriptionApi();
    const view = mount(true);
    expect(screen.getByText('Loading transcription model...')).toBeVisible();
    view.unmount();
    mount(false);
    expect(screen.getByText('Listening. Text appears here as people speak.')).toBeVisible();
    expect(screen.getByText(/Live preview only/)).toBeVisible();
  });

  it('draws committed lines and the interim suffix from the push', () => {
    const api = installTranscriptionApi();
    mount();
    const committed = '[00:00.00-00:02.00] [ Speaker-1 ] Buenos días';
    api.emit('transcription.liveUpdate', {
      displayText: `${committed}\n[00:02.00-00:03.00] Hoy vamos`,
      committedText: committed,
    });
    const pane = screen.getByTestId('live-transcript');
    expect(pane).toHaveTextContent('Buenos días');
    expect(pane).toHaveTextContent('Hoy vamos');
    expect(screen.getByText('S1')).toBeVisible();
    const items = pane.querySelectorAll('li');
    expect(items[0]).toHaveClass('text-ink');
    expect(items[1]).toHaveClass('text-ink-muted');
  });

  it('is reachable by keyboard so a long transcript can be scrolled', () => {
    installTranscriptionApi();
    mount();
    expect(screen.getByRole('region', { name: 'Live transcript' })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });
});
