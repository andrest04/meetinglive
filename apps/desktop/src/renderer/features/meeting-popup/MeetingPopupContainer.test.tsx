// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { MeetingPopupContainer } from './MeetingPopupContainer';

type Listener = (payload: never) => void;

function install(reducedMotion: boolean, shownAtStart = false) {
  const listeners = new Map<string, Listener>();
  const invoke = vi.fn((name: string, _input: unknown) =>
    Promise.resolve(name === 'meetingPrompt.ready' ? { shown: shownAtStart } : { done: true }),
  );
  Object.defineProperty(window, 'vozella', {
    configurable: true,
    value: {
      invoke,
      on: (name: string, listener: Listener) => {
        listeners.set(name, listener);
        return () => {
          listeners.delete(name);
        };
      },
    },
  });
  window.matchMedia = ((query: string) => ({
    matches: reducedMotion && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return {
    invoke,
    emit: (name: string, payload: unknown = {}) => {
      act(() => {
        listeners.get(name)?.(payload as never);
      });
    },
  };
}

function renderPopup() {
  render(
    <I18nProvider initialLocale="en">
      <MeetingPopupContainer />
    </I18nProvider>,
  );
}

const card = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.popup-card');
  if (!el) throw new Error('no card');
  return el;
};

describe('MeetingPopupContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the title, subtitle and both buttons with the existing strings', () => {
    install(false);
    renderPopup();
    expect(screen.getByText('Meeting detected')).toHaveAttribute('id', 'TxtMeetingPromptTitle');
    expect(screen.getByText('Take notes with Vozella')).toHaveAttribute(
      'id',
      'TxtMeetingPromptSubtitle',
    );
    expect(screen.getByRole('button', { name: 'Start recording' })).toHaveAttribute(
      'id',
      'BtnMeetingPromptStart',
    );
    expect(screen.getByRole('button', { name: 'More options' })).toHaveAttribute(
      'id',
      'BtnMeetingPromptMore',
    );
  });

  it('is hidden until main shows it, then plays the entrance (W7)', () => {
    const bridge = install(false);
    renderPopup();
    expect(card()).toHaveAttribute('data-phase', 'hidden');
    bridge.emit('meetingPrompt.show');
    expect(card()).toHaveAttribute('data-phase', 'in');
  });

  it('appears when main showed the popup before the page was listening', async () => {
    install(false, true);
    renderPopup();
    await act(async () => {
      await Promise.resolve();
    });
    expect(card()).toHaveAttribute('data-phase', 'in');
  });

  it('skips the entrance and the exit under reduced motion (W7)', () => {
    const bridge = install(true);
    renderPopup();
    bridge.emit('meetingPrompt.show');
    expect(card()).toHaveAttribute('data-phase', 'shown');
    bridge.emit('meetingPrompt.hide', { animated: true });
    expect(card()).toHaveAttribute('data-phase', 'hidden');
  });

  it('animates out on an animated hide and goes away at once otherwise', () => {
    const bridge = install(false);
    renderPopup();
    bridge.emit('meetingPrompt.show');
    bridge.emit('meetingPrompt.hide', { animated: true });
    expect(card()).toHaveAttribute('data-phase', 'out');
    bridge.emit('meetingPrompt.show');
    bridge.emit('meetingPrompt.hide', { animated: false });
    expect(card()).toHaveAttribute('data-phase', 'hidden');
  });

  it('a second show after a hide makes the card visible again with a fresh animation (W9)', () => {
    const bridge = install(false);
    renderPopup();
    bridge.emit('meetingPrompt.show');
    const first = card();
    bridge.emit('meetingPrompt.hide', { animated: true });
    expect(card()).toHaveAttribute('data-phase', 'out');
    bridge.emit('meetingPrompt.show');
    expect(card()).toHaveAttribute('data-phase', 'in');
    expect(card()).not.toBe(first);
  });

  it('shows the hover overlay and tells main when the pointer enters and leaves (W8)', () => {
    const bridge = install(false);
    renderPopup();
    bridge.emit('meetingPrompt.show');
    const overlay = screen.getByTestId('popup-overlay');
    expect(overlay).toHaveAttribute('data-visible', 'false');
    fireEvent.pointerEnter(card());
    expect(overlay).toHaveAttribute('data-visible', 'true');
    expect(bridge.invoke).toHaveBeenLastCalledWith('meetingPrompt.hover', { inside: true });
    fireEvent.pointerLeave(card());
    expect(overlay).toHaveAttribute('data-visible', 'false');
    expect(bridge.invoke).toHaveBeenLastCalledWith('meetingPrompt.hover', { inside: false });
  });

  it('Start asks main to start taking notes', async () => {
    const bridge = install(false);
    renderPopup();
    bridge.emit('meetingPrompt.show');
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
      .click(screen.getByRole('button', { name: 'Start recording' }));
    expect(bridge.invoke).toHaveBeenCalledWith('meetingPrompt.start', {});
  });

  it.each([
    ['MenuMeetingPromptDismiss', 'Dismiss', 'meetingPrompt.dismiss'],
    ['MenuMeetingPromptNeverAgain', "Don't notify me again", 'meetingPrompt.neverAgain'],
  ])('the More menu item %s calls %s', async (id, label, channel) => {
    const bridge = install(false);
    renderPopup();
    bridge.emit('meetingPrompt.show');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(screen.getByRole('button', { name: 'More options' }));
    const item = await screen.findByRole('menuitem', { name: label });
    expect(item).toHaveAttribute('data-testid', id);
    await user.click(item);
    expect(bridge.invoke).toHaveBeenCalledWith(channel, {});
  });

  it('uses the Spanish strings for an es locale', () => {
    install(false);
    render(
      <I18nProvider initialLocale="es">
        <MeetingPopupContainer />
      </I18nProvider>,
    );
    expect(screen.getByText('Reunión detectada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Empezar a grabar' })).toBeInTheDocument();
  });
});
