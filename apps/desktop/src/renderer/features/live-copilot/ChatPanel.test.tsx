// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import en from '../../i18n/locales/en.json';
import es from '../../i18n/locales/es.json';
import type { Locale } from '../../i18n/translate';
import { applyAnswer, IDLE_ANSWER, resetLiveAskStore } from '../record/use-live-ask';
import { applyQuestionDetected, resetLiveQuestionsStore } from '../record/use-live-questions';
import { ChatPanelContainer, withoutLeadingEmoji } from './ChatPanelContainer';
import { classifyPillLink } from './pill-links';

const calls: { name: string; input: Record<string, unknown> }[] = [];
let accept = true;

beforeEach(() => {
  calls.length = 0;
  accept = true;
  window.localStorage.clear();
  resetLiveAskStore();
  resetLiveQuestionsStore();
  Object.defineProperty(window, 'vozella', {
    configurable: true,
    writable: true,
    value: {
      invoke: (name: string, input: Record<string, unknown>) => {
        calls.push({ name, input });
        if (name === 'recording.ask') return Promise.resolve({ accepted: accept });
        if (name === 'chat.openExternal') return Promise.resolve({ status: 'opened' });
        return Promise.resolve({ done: true });
      },
      on: () => () => undefined,
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

function Panel({
  recording = true,
  locale = 'en',
  onOpenApp = () => undefined,
}: {
  recording?: boolean;
  locale?: Locale;
  onOpenApp?: () => void;
}) {
  return (
    <I18nProvider initialLocale={locale}>
      <ChatPanelContainer
        edge="Right"
        animate={false}
        recording={recording}
        onOpenApp={onOpenApp}
      />
    </I18nProvider>
  );
}

const answer = (over: Partial<typeof IDLE_ANSWER>) => {
  act(() => {
    applyAnswer({ ...IDLE_ANSWER, ...over });
  });
};
const asks = () => calls.filter((c) => c.name === 'recording.ask');
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe('layout', () => {
  it('pads the panel by 12 DIP and spaces its rows by 8 DIP (p-3, gap-2)', () => {
    render(<Panel />);
    const root = screen.getByTestId('LiveCopilotPanel');
    expect(root.className).toContain('p-3');
    expect(root.className).toContain('gap-2');
  });
});

describe('the answer area', () => {
  it('shows the empty hint only with no answer, no ask in flight and no error', () => {
    render(<Panel />);
    expect(screen.getByTestId('TxtLiveCopilotEmpty')).toHaveTextContent('Ask a question below.');
    answer({ isAnswering: true });
    expect(screen.queryByTestId('TxtLiveCopilotEmpty')).toBeNull();
    answer({ text: 'Hello' });
    expect(screen.queryByTestId('TxtLiveCopilotEmpty')).toBeNull();
    answer({ error: { key: null, text: 'boom' } });
    expect(screen.queryByTestId('TxtLiveCopilotEmpty')).toBeNull();
    answer({});
    expect(screen.getByTestId('TxtLiveCopilotEmpty')).toBeInTheDocument();
  });

  it('says in Spanish that a question goes below, without the detection the app dropped', () => {
    render(<Panel locale="es" />);
    expect(screen.getByTestId('TxtLiveCopilotEmpty')).toHaveTextContent(
      'Escribe una pregunta abajo.',
    );
  });

  it('draws the progress ring only while answering, named Answering', () => {
    render(<Panel />);
    expect(screen.queryByTestId('ProgressLiveCopilot')).toBeNull();
    answer({ isAnswering: true });
    expect(screen.getByRole('progressbar', { name: 'Answering' })).toBe(
      screen.getByTestId('ProgressLiveCopilot'),
    );
    answer({ isAnswering: false, text: 'done' });
    expect(screen.queryByTestId('ProgressLiveCopilot')).toBeNull();
  });

  it('shows the error with its title and the translated catalog key or ready text', () => {
    render(<Panel />);
    answer({ error: { key: 'LiveCopilot_NeedsSetup', text: '' } });
    const notice = screen.getByTestId('InfoLiveCopilotError');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent('Could not answer');
    expect(notice).toHaveTextContent('Open Vozella to finish provider setup.');
    answer({ error: { key: null, text: 'The CLI said no' } });
    expect(screen.getByTestId('InfoLiveCopilotError')).toHaveTextContent('The CLI said no');
  });

  it('shows the web badge, without the emoji, only when the answer used the web', () => {
    render(<Panel />);
    answer({ text: 'a' });
    expect(screen.queryByTestId('BadgeLiveCopilotWeb')).toBeNull();
    answer({ text: 'a', usedWeb: true });
    const badge = screen.getByTestId('BadgeLiveCopilotWeb');
    expect(badge).toHaveTextContent('Searched the web');
    expect(badge.textContent).not.toContain('\u{1F310}');
    expect(withoutLeadingEmoji('\u{1F310} Búsqueda en la web')).toBe('Búsqueda en la web');
  });

  it('renders Markdown and never raw HTML', () => {
    const { container } = render(<Panel />);
    answer({
      text: '**bold** <script>window.__x = 1</script> <img src=x onerror="window.__x=2"> <b>raw</b>',
    });
    const md = screen.getByTestId('MdLiveCopilotAnswer');
    expect(within(md).getByText('bold').tagName).toBe('STRONG');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(md.textContent).toContain('<script>');
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });
});

describe('links', () => {
  it('classifies only absolute http and https addresses', () => {
    expect(classifyPillLink('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(classifyPillLink(' http://example.com ')).toBe('http://example.com/');
    for (const bad of [
      'javascript:alert(1)',
      'file:///C:/x',
      'mailto:a@b.c',
      'vozella://app/x',
      'meeting://{1}',
      '/relative',
      '',
    ]) {
      expect(classifyPillLink(bad)).toBeNull();
    }
  });

  it('opens an https link through the system browser and ignores every other scheme', async () => {
    render(<Panel />);
    answer({
      text: '[web](https://example.com/x) [js](javascript:alert(1)) [file](file:///C:/x) [mail](mailto:a@b.c)',
    });
    const user = userEvent.setup();
    for (const name of ['js', 'file', 'mail']) {
      const link = screen.queryByRole('link', { name });
      if (link) await user.click(link);
    }
    expect(calls.filter((c) => c.name === 'chat.openExternal')).toEqual([]);
    await user.click(screen.getByRole('link', { name: 'web' }));
    expect(calls.filter((c) => c.name === 'chat.openExternal')).toEqual([
      { name: 'chat.openExternal', input: { url: 'https://example.com/x' } },
    ]);
  });

  it('ignores a failed launch silently', async () => {
    render(<Panel />);
    (window.vozella as unknown as { invoke: unknown }).invoke = () =>
      Promise.reject(new Error('no browser'));
    answer({ text: '[web](https://example.com/x)' });
    await userEvent.setup().click(screen.getByRole('link', { name: 'web' }));
    await settle();
    expect(screen.queryByTestId('InfoLiveCopilotError')).toBeNull();
  });
});

describe('chips', () => {
  it.each([
    [
      'en',
      'BtnLiveCopilotChipMissed',
      'What did I miss?',
      'What did I miss? Summarize the last few minutes.',
    ],
    [
      'en',
      'BtnLiveCopilotChipExplain',
      'Explain simply',
      'Explain the last point in simple terms.',
    ],
    [
      'es',
      'BtnLiveCopilotChipMissed',
      '¿Qué me perdí?',
      '¿Qué me perdí? Resume los últimos minutos.',
    ],
    [
      'es',
      'BtnLiveCopilotChipExplain',
      'Explicar fácil',
      'Explica el último punto en términos sencillos.',
    ],
  ] as const)(
    '%s %s reads "%s" and asks the translated prompt as a preset',
    async (locale, id, label, prompt) => {
      render(<Panel locale={locale} />);
      const chip = screen.getByTestId(id);
      expect(chip).toHaveTextContent(label);
      await userEvent.setup().click(chip);
      expect(asks()).toEqual([
        { name: 'recording.ask', input: { question: prompt, webSearch: false, preset: true } },
      ]);
    },
  );

  it('names the chips with the long accessible names and disables them outside a take', () => {
    render(<Panel recording={false} />);
    const missed = screen.getByTestId('BtnLiveCopilotChipMissed');
    expect(missed).toHaveAccessibleName('Ask what you missed in the last few minutes');
    expect(missed).toBeDisabled();
    expect(screen.getByTestId('BtnLiveCopilotChipExplain')).toHaveAccessibleName(
      'Ask for the last point in simple terms',
    );
  });

  it('does not leave the typed text behind or use it for a chip', async () => {
    render(<Panel />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId('TxtLiveCopilotAsk'), 'draft');
    await user.click(screen.getByTestId('BtnLiveCopilotChipExplain'));
    expect(asks()[0]?.input).toMatchObject({ question: 'Explain the last point in simple terms.' });
    expect(screen.getByTestId('TxtLiveCopilotAsk')).toHaveValue('draft');
  });
});

describe('the typed ask', () => {
  it('sends on Ctrl+Enter inside the box and clears the text once main took it', async () => {
    render(<Panel />);
    const box = screen.getByTestId('TxtLiveCopilotAsk');
    const user = userEvent.setup();
    await user.type(box, '  who owns the budget?  ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(asks()).toEqual([
      { name: 'recording.ask', input: { question: 'who owns the budget?', webSearch: false } },
    ]);
    await settle();
    expect(box).toHaveValue('');
  });

  it('keeps the text when main refused the question', async () => {
    accept = false;
    render(<Panel />);
    const box = screen.getByTestId('TxtLiveCopilotAsk');
    await userEvent.setup().type(box, 'hello');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await settle();
    expect(box).toHaveValue('hello');
  });

  it('does nothing for a plain Enter, for Ctrl+Enter on another element, or when blank', async () => {
    render(<Panel />);
    const box = screen.getByTestId('TxtLiveCopilotAsk');
    const user = userEvent.setup();
    await user.type(box, 'hi{Enter}');
    expect(asks()).toHaveLength(0);
    fireEvent.keyDown(screen.getByTestId('LiveCopilotAnswerArea'), { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId('BtnLiveCopilotChipMissed'), {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(asks()).toHaveLength(0);
    await user.clear(box);
    await user.type(box, '   ');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(asks()).toHaveLength(0);
  });

  it('enables send only with a take and non-blank text', async () => {
    const view = render(<Panel recording={false} />);
    const send = screen.getByTestId('BtnLiveCopilotSend');
    const box = screen.getByTestId('TxtLiveCopilotAsk');
    const user = userEvent.setup();
    expect(send).toBeDisabled();
    await user.type(box, 'hello');
    expect(send).toBeDisabled();
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(asks()).toHaveLength(0);
    view.rerender(<Panel recording />);
    expect(box).toHaveValue(''); // a new take starts with an empty box
    expect(send).toBeDisabled();
    await user.type(box, 'hello');
    expect(send).toBeEnabled();
    await user.clear(box);
    await user.type(box, '  ');
    expect(send).toBeDisabled();
    await user.type(box, 'x');
    await user.click(send);
    expect(asks()).toHaveLength(1);
  });

  it('clears an unsent draft when a new take starts, and keeps it while the take runs', async () => {
    const view = render(<Panel recording={false} />);
    const box = screen.getByTestId('TxtLiveCopilotAsk');
    const user = userEvent.setup();
    await user.type(box, 'old draft');
    view.rerender(<Panel recording />);
    expect(box).toHaveValue('');
    await user.type(box, 'new draft');
    view.rerender(<Panel recording />);
    expect(box).toHaveValue('new draft');
  });

  it('names the box, the toggle and the send button', () => {
    render(<Panel />);
    expect(screen.getByTestId('TxtLiveCopilotAsk')).toHaveAccessibleName('Type a question');
    expect(screen.getByTestId('TxtLiveCopilotAsk')).toHaveAttribute(
      'placeholder',
      'Type a question, then press Ctrl+Enter',
    );
    expect(screen.getByTestId('BtnLiveCopilotSend')).toHaveAccessibleName('Ask the question');
    expect(screen.getByTestId('ToggleLiveCopilotWeb')).toHaveAccessibleName(
      'Search the web for the answer',
    );
  });
});

describe('the web toggle', () => {
  it('is disabled with the Off tooltip when the provider cannot search the web', () => {
    render(<Panel />);
    const toggle = screen.getByTestId('ToggleLiveCopilotWeb');
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('title', 'No web search with this provider');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles when allowed, is sent with the ask and persists across takes', async () => {
    render(<Panel />);
    answer({ canUseWebSearch: true });
    const toggle = screen.getByTestId('ToggleLiveCopilotWeb');
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('title', 'Search the web for the answer');
    const user = userEvent.setup();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.type(screen.getByTestId('TxtLiveCopilotAsk'), 'q');
    await user.click(screen.getByTestId('BtnLiveCopilotSend'));
    expect(asks()[0]?.input).toMatchObject({ webSearch: true });
    // A new take resets the answer, not the toggle.
    answer({ canUseWebSearch: true, text: '' });
    expect(screen.getByTestId('ToggleLiveCopilotWeb')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('opening motion', () => {
  const play = (edge: 'Left' | 'Right' | 'Top' | 'Bottom', animate: boolean, reduced = false) => {
    const animateFn = vi.fn(() => ({ cancel: vi.fn() }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animateFn,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: reduced && query.includes('reduce'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    render(
      <I18nProvider initialLocale="en">
        <ChatPanelContainer edge={edge} animate={animate} recording onOpenApp={() => undefined} />
      </I18nProvider>,
    );
    return animateFn as unknown as { mock: { calls: [Keyframe[], KeyframeAnimationOptions][] } };
  };
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  });

  it.each([
    ['Right', '16px 0'],
    ['Left', '-16px 0'],
    ['Top', '0 -16px'],
    ['Bottom', '0 16px'],
  ] as const)('fades in and slides 16 DIP from the %s edge over 220 ms', (edge, from) => {
    const spy = play(edge, true);
    expect(spy.mock.calls).toHaveLength(1);
    const [frames, options] = spy.mock.calls[0] ?? [[], {}];
    expect(frames).toEqual([
      { opacity: 0, translate: from },
      { opacity: 1, translate: '0 0' },
    ]);
    expect(options).toMatchObject({
      duration: 220,
      easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
    });
  });

  it('plays nothing when animations are off or the user prefers reduced motion', () => {
    expect(play('Right', false).mock.calls).toHaveLength(0);
    cleanup();
    expect(play('Right', true, true).mock.calls).toHaveLength(0);
  });
});

describe('the header', () => {
  it('shows the title and opens the app', async () => {
    const onOpenApp = vi.fn();
    render(<Panel onOpenApp={onOpenApp} />);
    expect(screen.getByTestId('TxtLiveCopilotTitle')).toHaveTextContent('Live copilot');
    await userEvent.setup().click(screen.getByTestId('BtnLiveCopilotOpenApp'));
    expect(onOpenApp).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('BtnLiveCopilotOpenApp')).toHaveAccessibleName('Open Vozella');
  });

  it('builds no detected-question card and no dead controls for the cut features', () => {
    render(<Panel />);
    for (const id of ['InfoLiveCopilotQuestion', 'BtnLiveCopilotAnswer', 'BtnLiveCopilotDismiss']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });
});

describe('string and control audit', () => {
  const keys = [
    'LiveCopilot_Title',
    'LiveCopilot_StatusRecording',
    'LiveCopilot_StatusPaused',
    'LiveCopilot_StartedMessage',
    'LiveCopilot_ArmedBadge.AutomationProperties.Name',
    'LiveCopilot_Expand.AutomationProperties.Name',
    'LiveCopilot_Expand.ToolTipService.ToolTip',
    'LiveCopilot_Collapse.AutomationProperties.Name',
    'LiveCopilot_Collapse.ToolTipService.ToolTip',
    'LiveCopilot_Pause.AutomationProperties.Name',
    'LiveCopilot_Resume.AutomationProperties.Name',
    'LiveCopilot_Stop.AutomationProperties.Name',
    'LiveCopilot_Stop.ToolTipService.ToolTip',
    'LiveCopilot_OpenApp.AutomationProperties.Name',
    'LiveCopilot_OpenApp.ToolTipService.ToolTip',
    'LiveCopilot_Empty.Text',
    'LiveCopilot_WebBadge.Text',
    'LiveCopilot_ChipMissed.Content',
    'LiveCopilot_ChipMissed.AutomationProperties.Name',
    'LiveCopilot_PromptMissed',
    'LiveCopilot_ChipExplain.Content',
    'LiveCopilot_ChipExplain.AutomationProperties.Name',
    'LiveCopilot_PromptExplain',
    'LiveCopilot_Send.AutomationProperties.Name',
    'LiveCopilot_Send.ToolTipService.ToolTip',
    'LiveCopilot_WebToggle.AutomationProperties.Name',
    'LiveCopilot_WebTooltipOn',
    'LiveCopilot_WebTooltipOff',
    'LiveCopilot_NeedsSetup',
    'RecordPage_LiveQuestionNotice.Title',
    'RecordPage_LiveQuestionNotice.AutomationProperties.Name',
    'RecordPage_LiveAnswer.Content',
    'RecordPage_LiveAnswer.AutomationProperties.Name',
    'RecordPage_LiveAnswerTooltip',
    'RecordPage_LiveAnswerDismiss.Content',
    'RecordPage_LiveAnswerDismiss.AutomationProperties.Name',
    'RecordPage_LiveAsk.PlaceholderText',
    'RecordPage_LiveAsk.AutomationProperties.Name',
    'RecordPage_LiveAnswerProgress.AutomationProperties.Name',
    'RecordPage_LiveAnswerError.Title',
    'RecordPage_LiveAnswerError.AutomationProperties.Name',
    'RecordPage_LiveAnswerEmpty',
    'Status_SetupCancelled',
  ];

  it('has every section 2.8 key in both locales, non-empty', () => {
    const english = en as Record<string, string>;
    const spanish = es as Record<string, string>;
    for (const key of keys) {
      expect(english[key], `en ${key}`).toBeTruthy();
      expect(spanish[key], `es ${key}`).toBeTruthy();
    }
    const family = (catalog: Record<string, string>) =>
      Object.keys(catalog)
        .filter((k) => /^(LiveCopilot_|RecordPage_Live)/.test(k))
        .sort();
    expect(family(english)).toEqual(family(spanish));
  });

  it('writes no em dash and no emoji in the strings the panel shows', () => {
    for (const catalog of [en, es] as Record<string, string>[]) {
      for (const key of keys.filter((k) => k !== 'LiveCopilot_WebBadge.Text')) {
        expect(catalog[key], key).not.toMatch(/\u2014|\p{Extended_Pictographic}/u);
      }
    }
  });

  it.each(['en', 'es'] as const)('every control has a name, an id and a test id (%s)', (locale) => {
    render(<Panel locale={locale} />);
    answer({ canUseWebSearch: true, text: 'x', usedWeb: true });
    const panel = screen.getByTestId('LiveCopilotPanel');
    const controls = Array.from(panel.querySelectorAll('button, input, [role="region"]'));
    expect(controls.length).toBeGreaterThanOrEqual(7);
    for (const control of controls) {
      expect(control.getAttribute('data-testid'), control.outerHTML).toBeTruthy();
      expect(control.id, control.outerHTML).not.toBe('');
      expect(control.getAttribute('aria-label'), control.outerHTML).toBeTruthy();
    }
    for (const control of Array.from(panel.querySelectorAll('button, input'))) {
      expect(control.classList.contains('pill-no-drag')).toBe(true);
    }
  });
});

describe('detected question', () => {
  it('shows the card above the chips and answers it through the live ask', async () => {
    render(<Panel locale="es" />);
    expect(screen.queryByTestId('LiveQuestionCard')).toBeNull();
    act(() => {
      applyQuestionDetected({ id: 'q1', body: '¿Qué es Scrum?', atMs: 0, confirmed: true });
    });
    const card = screen.getByRole('region', { name: 'Pregunta detectada' });
    expect(card.compareDocumentPosition(screen.getByTestId('BtnLiveCopilotChipMissed'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await userEvent.click(within(card).getByRole('button', { name: 'Responder' }));
    await settle();
    expect(asks()).toEqual([
      { name: 'recording.ask', input: { question: '¿Qué es Scrum?', webSearch: false } },
    ]);
    expect(calls.at(-1)).toEqual({ name: 'recording.dismissQuestion', input: { id: 'q1' } });
    expect(screen.queryByTestId('LiveQuestionCard')).toBeNull();
  });
});
