// @vitest-environment jsdom
import type { ChatPromptDto, ChatSendOutcomeDto, ChatStateDto } from '@vozella/contracts';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { DialogHost } from '../shell/dialog-service';
import { ChatBody } from './ChatBody';

// Phase 5: saved prompts in the `/` menu, the chips, the dialogs, and "Save as prompt".

vi.mock('../summaries/ProviderGateDialogs', () => ({ ProviderGateDialogs: () => null }));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

type Listener = (payload: unknown) => void;

const MEETING = { isVisible: true, kind: 'Meeting', folderId: null, meetingId: 'm1' } as const;
const ALL = { isVisible: true, kind: 'AllMeetings', folderId: null, meetingId: null } as const;

const saved = (n: number, over: Partial<ChatPromptDto> = {}): ChatPromptDto => ({
  id: `p${String(n)}`,
  name: `Risk review ${String(n)}`,
  prompt: `List the risks, take ${String(n)}.`,
  availability: 'single',
  engine: null,
  ...over,
});

const stateOf = (over: Partial<ChatStateDto> = {}): ChatStateDto => ({
  messages: [],
  isSending: false,
  showScopeMismatch: false,
  hasMessages: false,
  canStartNewChat: true,
  attachments: [],
  ...over,
});

const msg = (id: string, role: 'user' | 'assistant', text: string) => ({
  id,
  role,
  text,
  createdAt: '2026-09-01T09:00:00Z',
});

function install(
  options: {
    prompts?: ChatPromptDto[];
    state?: ChatStateDto;
    answer?: (name: string, input: Record<string, unknown>) => unknown;
  } = {},
) {
  const listeners = new Map<string, Set<Listener>>();
  const inputs: { name: string; input: Record<string, unknown> }[] = [];
  const invoke = vi.fn(async (name: string, input: Record<string, unknown>) => {
    await Promise.resolve();
    inputs.push({ name, input });
    const scripted = options.answer?.(name, input);
    if (scripted !== undefined) return scripted;
    switch (name) {
      case 'chat.state':
        return options.state ?? stateOf();
      case 'chat.prompts.list':
        return { prompts: options.prompts ?? [] };
      case 'workspace.getState':
        return { liveTranscript: '' };
      case 'library.getMeeting':
        return { record: { id: input.id, actionItems: [{ text: 'x', isDone: false }] } };
      case 'chat.send':
        return {
          status: 'answered',
          user: msg('u1', 'user', input.draft as string),
          assistant: msg('a1', 'assistant', 'Done.'),
          notice: null,
        } satisfies ChatSendOutcomeDto;
      case 'chat.prompts.create':
      case 'chat.prompts.update':
        return {
          status: 'saved',
          prompt: { id: (input.id as string | undefined) ?? 'new', ...(input.draft as object) },
        };
      case 'chat.prompts.delete':
        return { status: 'deleted' };
      case 'chat.attach.list':
        return { attachments: [], notice: null };
      default:
        throw new Error(`unhandled ${name}`);
    }
  });
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke,
      on: (name: string, listener: Listener) => {
        const set = listeners.get(name) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(name, set);
        return () => set.delete(listener);
      },
    },
    configurable: true,
    writable: true,
  });
  const emit = (name: string, payload: unknown) => {
    listeners.get(name)?.forEach((l) => {
      l(payload);
    });
  };
  const calls = (name: string) => inputs.filter((i) => i.name === name).map((i) => i.input);
  return { emit, calls };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = (scope: typeof MEETING | typeof ALL = MEETING, locale: 'en' | 'es' = 'en') =>
  render(
    <Providers locale={locale}>
      <DialogHost>
        <ChatBody scope={scope} />
      </DialogHost>
    </Providers>,
  );

const box = () => screen.getByTestId<HTMLTextAreaElement>('TxtMeetingChat');
const first = (list: readonly HTMLElement[]): HTMLElement => {
  const found = list[0];
  if (!found) throw new Error('no element');
  return found;
};
const options = () => within(screen.getByTestId('ListMeetingChatRecipes')).getAllByRole('option');

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('BtnMeetingChatRecipes'));
  return screen.getByTestId('ListMeetingChatRecipes');
}

describe('the / menu lists saved prompts first', () => {
  it('groups "Your prompts" before the suggested recipes, only those of the scope', async () => {
    install({ prompts: [saved(1), saved(2, { availability: 'multiple' })] });
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    const list = await openMenu(user);
    const mine = within(list).getByRole('group', { name: 'Your prompts' });
    expect(
      within(mine)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining('Risk review 1')]);
    expect(within(list).getByRole('group', { name: 'Suggested' })).toBeInTheDocument();
    expect(options()[0]).toHaveAttribute('data-owner', 'user');
    expect(list).not.toHaveTextContent('Risk review 2');
  });

  it('the slash filter finds a saved prompt by its name', async () => {
    install({ prompts: [saved(1)] });
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    await user.type(box(), '/risk rev');
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent('Risk review 1');
  });

  it('shows the Spanish section names', async () => {
    install({ prompts: [saved(1)] });
    const user = userEvent.setup();
    mount(MEETING, 'es');
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    const list = await openMenu(user);
    expect(within(list).getByRole('group', { name: 'Tus prompts' })).toBeInTheDocument();
    expect(screen.getByTestId('BtnChatPromptNew')).toHaveTextContent('Nuevo prompt…');
  });

  it('follows chat.promptsChanged', async () => {
    const api = install({ prompts: [] });
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toBeInTheDocument();
    });
    act(() => {
      api.emit('chat.promptsChanged', { prompts: [saved(7)] });
    });
    expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 7');
  });
});

describe('running a saved prompt', () => {
  it('a chip leads with the saved prompt and sends it with its engine', async () => {
    const api = install({ prompts: [saved(1, { engine: 'codex' }), saved(2), saved(3)] });
    const user = userEvent.setup();
    mount();
    const chips = await screen.findByTestId('ListMeetingChatStarters');
    await waitFor(() => {
      expect(within(chips).getAllByRole('button')[0]).toHaveTextContent('Risk review 1');
    });
    const labels = within(chips)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toHaveLength(4);
    expect(labels.slice(0, 2)).toEqual(['Risk review 1', 'Risk review 2']);
    await user.click(first(within(chips).getAllByRole('button')));
    await waitFor(() => {
      expect(api.calls('chat.send')).toHaveLength(1);
    });
    expect(api.calls('chat.send')[0]).toMatchObject({
      draft: 'List the risks, take 1.',
      engine: 'codex',
    });
  });

  it('a pick from the menu arms its engine for the next send only', async () => {
    const api = install({ prompts: [saved(1, { engine: 'local' })] });
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    await openMenu(user);
    await user.click(first(options()));
    expect(box()).toHaveValue('List the risks, take 1.');
    expect(screen.getByTestId('TxtChatPromptEngine')).toHaveTextContent('Answers with Local');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(api.calls('chat.send')).toHaveLength(1);
    });
    expect(api.calls('chat.send')[0]).toMatchObject({ engine: 'local' });
    await user.type(box(), 'And then?{Enter}');
    await waitFor(() => {
      expect(api.calls('chat.send')).toHaveLength(2);
    });
    expect(api.calls('chat.send')[1]).not.toHaveProperty('engine');
  });

  it('a failed send gives the text back with its engine still armed', async () => {
    let sends = 0;
    const api = install({
      prompts: [saved(1, { engine: 'codex' })],
      answer: (name, input) => {
        if (name !== 'chat.send') return undefined;
        sends += 1;
        if (sends > 1) return undefined;
        return {
          status: 'failed',
          kind: 'send-failed',
          message: 'Could not answer. Codex is busy.',
          originalDraft: input.draft as string,
        };
      },
    });
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    await openMenu(user);
    await user.click(first(options()));
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(box()).toHaveValue('List the risks, take 1.');
    });
    expect(screen.getByTestId('TxtChatPromptEngine')).toHaveTextContent('Answers with Codex');
    await user.click(box());
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(api.calls('chat.send')).toHaveLength(2);
    });
    expect(api.calls('chat.send')[1]).toMatchObject({
      draft: 'List the risks, take 1.',
      engine: 'codex',
    });
  });

  it('a chip whose send fails leaves its prompt in the box, armed with its engine', async () => {
    install({
      prompts: [saved(1, { engine: 'codex' })],
      answer: (name, input) =>
        name === 'chat.send'
          ? {
              status: 'failed',
              kind: 'send-failed',
              message: 'Could not answer.',
              originalDraft: input.draft as string,
            }
          : undefined,
    });
    const user = userEvent.setup();
    mount();
    const chips = await screen.findByTestId('ListMeetingChatStarters');
    await waitFor(() => {
      expect(within(chips).getAllByRole('button')[0]).toHaveTextContent('Risk review 1');
    });
    await user.click(first(within(chips).getAllByRole('button')));
    await waitFor(() => {
      expect(box()).toHaveValue('List the risks, take 1.');
    });
    expect(screen.getByTestId('TxtChatPromptEngine')).toHaveTextContent('Answers with Codex');
  });

  it('clearing the draft disarms the engine', async () => {
    const api = install({ prompts: [saved(1, { engine: 'codex' })] });
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    await openMenu(user);
    await user.click(first(options()));
    await user.clear(box());
    expect(screen.queryByTestId('TxtChatPromptEngine')).toBeNull();
    await user.type(box(), 'Plain question{Enter}');
    await waitFor(() => {
      expect(api.calls('chat.send')).toHaveLength(1);
    });
    expect(api.calls('chat.send')[0]).not.toHaveProperty('engine');
  });
});

describe('create, edit, delete', () => {
  it('New prompt… opens the dialog; a blank name is refused in place', async () => {
    const api = install();
    const user = userEvent.setup();
    mount();
    await openMenu(user);
    await user.click(screen.getByTestId('BtnChatPromptNew'));
    const dialog = await screen.findByRole('dialog', { name: 'New prompt' });
    await user.type(within(dialog).getByTestId('TxtChatPromptText'), 'Summarize the risks.');
    await user.click(within(dialog).getByTestId('BtnChatPromptSave'));
    expect(within(dialog).getByText('Give the prompt a name.')).toBeInTheDocument();
    expect(api.calls('chat.prompts.create')).toHaveLength(0);

    await user.type(within(dialog).getByTestId('TxtChatPromptName'), 'Risks');
    await user.click(within(dialog).getByRole('radio', { name: 'Several meetings' }));
    await user.click(within(dialog).getByTestId('BtnChatPromptSave'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls('chat.prompts.create')).toEqual([
      {
        draft: {
          name: 'Risks',
          prompt: 'Summarize the risks.',
          availability: 'multiple',
          engine: null,
        },
      },
    ]);
  });

  it('a new prompt takes the draft typed so far, and the limit answer stays in the dialog', async () => {
    install({
      answer: (name) => (name === 'chat.prompts.create' ? { status: 'limit' } : undefined),
    });
    const user = userEvent.setup();
    mount();
    await user.type(box(), 'What did we promise the client?');
    await openMenu(user);
    await user.click(screen.getByTestId('BtnChatPromptNew'));
    const dialog = await screen.findByRole('dialog', { name: 'New prompt' });
    expect(within(dialog).getByTestId('TxtChatPromptText')).toHaveValue(
      'What did we promise the client?',
    );
    await user.type(within(dialog).getByTestId('TxtChatPromptName'), 'Promises');
    await user.click(within(dialog).getByTestId('BtnChatPromptSave'));
    expect(
      await within(dialog).findByText(
        'You can keep up to 100 prompts. Delete one to save another.',
      ),
    ).toBeInTheDocument();
  });

  it('keyboard: ArrowDown to a saved prompt, Tab to Edit, save the change', async () => {
    const api = install({ prompts: [saved(1, { engine: 'codex' })] });
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    await user.click(box());
    await user.keyboard('/');
    await user.keyboard('{ArrowDown}');
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    await user.tab();
    expect(screen.getByTestId('BtnChatPromptEdit')).toHaveFocus();
    expect(screen.getByTestId('BtnChatPromptEdit')).toHaveAccessibleName('Edit Risk review 1');
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Edit prompt' });
    const name = within(dialog).getByTestId('TxtChatPromptName');
    expect(name).toHaveValue('Risk review 1');
    expect(within(dialog).getByTestId('CmbChatPromptEngine')).toHaveTextContent('Codex');
    await user.clear(name);
    await user.type(name, 'Risks');
    await user.click(within(dialog).getByTestId('BtnChatPromptSave'));
    await waitFor(() => {
      expect(api.calls('chat.prompts.update')).toHaveLength(1);
    });
    expect(api.calls('chat.prompts.update')[0]).toEqual({
      id: 'p1',
      draft: {
        name: 'Risks',
        prompt: 'List the risks, take 1.',
        availability: 'single',
        engine: 'codex',
      },
    });
  });

  it('delete asks first; Cancel keeps it, Delete removes it', async () => {
    const api = install({ prompts: [saved(1)] });
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    await user.click(box());
    await user.keyboard('/{ArrowDown}');
    await user.tab();
    await user.tab();
    expect(screen.getByTestId('BtnChatPromptDelete')).toHaveFocus();
    await user.keyboard('{Enter}');
    let dialog = await screen.findByRole('dialog', { name: 'Delete this prompt?' });
    expect(dialog).toHaveTextContent('“Risk review 1” will be removed from your prompts.');
    // The safe button takes the focus (Base UI moves it after the open).
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls('chat.prompts.delete')).toHaveLength(0);

    await openMenu(user);
    await user.click(first(screen.getAllByTestId('BtnChatPromptRowDelete')));
    dialog = await screen.findByRole('dialog', { name: 'Delete this prompt?' });
    await user.click(within(dialog).getByTestId('BtnChatPromptDeleteConfirm'));
    await waitFor(() => {
      expect(api.calls('chat.prompts.delete')).toEqual([{ id: 'p1' }]);
    });
  });

  it('row icons stay out of the tab order and out of the option name', async () => {
    install({ prompts: [saved(1)] });
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    await openMenu(user);
    const edit = first(screen.getAllByTestId('BtnChatPromptRowEdit'));
    expect(edit).toHaveAttribute('tabindex', '-1');
    expect(edit.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('Save as prompt from a sent message', () => {
  it('opens the dialog with the message as the prompt and a short name', async () => {
    const api = install({
      state: stateOf({
        messages: [
          msg('u1', 'user', 'Which decisions were made\nand by whom?'),
          msg('a1', 'assistant', 'Two.'),
        ],
        hasMessages: true,
      }),
    });
    const user = userEvent.setup();
    mount(ALL);
    const save = await screen.findByTestId('BtnMeetingChatSaveAsPrompt');
    expect(save).toHaveAccessibleName('Save as prompt');
    await user.click(save);
    const dialog = await screen.findByRole('dialog', { name: 'New prompt' });
    expect(within(dialog).getByTestId('TxtChatPromptText')).toHaveValue(
      'Which decisions were made\nand by whom?',
    );
    expect(within(dialog).getByTestId('TxtChatPromptName')).toHaveValue(
      'Which decisions were made',
    );
    // A folder or all meetings make it a several-meetings prompt.
    expect(within(dialog).getByRole('radio', { name: 'Several meetings' })).toBeChecked();
    await user.click(within(dialog).getByTestId('BtnChatPromptSave'));
    await waitFor(() => {
      expect(api.calls('chat.prompts.create')).toHaveLength(1);
    });
  });
});

describe('import and export', () => {
  it('reports what the import did, and refuses a bad file in plain words', async () => {
    let next: unknown = { status: 'imported', added: 3, renamed: 1, skipped: 0 };
    install({
      prompts: [saved(1)],
      answer: (name) => (name === 'chat.prompts.import' ? next : undefined),
    });
    const user = userEvent.setup();
    mount();
    await openMenu(user);
    await user.click(screen.getByTestId('BtnChatPromptsImport'));
    const notice = await screen.findByTestId('InfoChatPromptsNotice');
    expect(notice).toHaveTextContent('3 prompts imported.');
    expect(notice).toHaveTextContent('1 got a number because the name was taken.');

    next = { status: 'invalid' };
    await openMenu(user);
    await user.click(screen.getByTestId('BtnChatPromptsImport'));
    await waitFor(() => {
      expect(screen.getByTestId('InfoChatPromptsNotice')).toHaveTextContent(
        'This is not a Vozella prompts file. Nothing was added.',
      );
    });
  });

  it('export says how many prompts went out; it is off with no prompts', async () => {
    install({
      prompts: [],
      answer: (name) =>
        name === 'chat.prompts.export' ? { status: 'exported', count: 1 } : undefined,
    });
    const user = userEvent.setup();
    const view = mount();
    await openMenu(user);
    expect(screen.getByTestId('BtnChatPromptsExport')).toBeDisabled();
    view.unmount();

    install({
      prompts: [saved(1)],
      answer: (name) =>
        name === 'chat.prompts.export' ? { status: 'exported', count: 1 } : undefined,
    });
    mount();
    await waitFor(() => {
      expect(screen.getByTestId('ListMeetingChatStarters')).toHaveTextContent('Risk review 1');
    });
    await openMenu(user);
    await user.click(screen.getByTestId('BtnChatPromptsExport'));
    expect(await screen.findByTestId('InfoChatPromptsNotice')).toHaveTextContent(
      '1 prompt exported.',
    );
  });
});
