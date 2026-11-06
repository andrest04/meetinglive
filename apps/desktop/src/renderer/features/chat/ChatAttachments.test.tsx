// @vitest-environment jsdom
import type { ChatAttachmentDto, ChatAttachmentListDto, ChatStateDto } from '@vozella/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { DialogHost } from '../shell/dialog-service';
import { ChatBody } from './ChatBody';

vi.mock('../summaries/ProviderGateDialogs', () => ({ ProviderGateDialogs: () => null }));

type Listener = (payload: unknown) => void;

const MEETING = { isVisible: true, kind: 'Meeting', folderId: null, meetingId: 'm1' } as const;

const chip = (over: Partial<ChatAttachmentDto> = {}): ChatAttachmentDto => ({
  id: 'att-1',
  name: 'plan.pdf',
  kind: 'pdf',
  sizeBytes: 250_000,
  pages: 12,
  status: 'ready',
  message: null,
  truncated: false,
  ...over,
});

const stateOf = (attachments: ChatAttachmentDto[] = []): ChatStateDto => ({
  messages: [],
  isSending: false,
  showScopeMismatch: false,
  hasMessages: false,
  canStartNewChat: true,
  attachments,
});

interface Rig {
  emit: (name: string, payload: unknown) => void;
  inputs: { name: string; input: Record<string, unknown> }[];
  dropped: File[][];
}

function install(
  options: {
    list?: ChatAttachmentDto[];
    pick?: () => ChatAttachmentListDto;
    sendNotice?: string | null;
  } = {},
): Rig {
  const listeners = new Map<string, Set<Listener>>();
  let current = options.list ?? [];
  const rig: Rig = {
    inputs: [],
    dropped: [],
    emit: (name, payload) => {
      listeners.get(name)?.forEach((listener) => {
        listener(payload);
      });
    },
  };
  const listDto = (): ChatAttachmentListDto => ({ attachments: current, notice: null });
  const invoke = vi.fn((name: string, input: Record<string, unknown>) => {
    rig.inputs.push({ name, input });
    switch (name) {
      case 'chat.state':
        return Promise.resolve(stateOf(current));
      case 'chat.attach.list':
        return Promise.resolve(listDto());
      case 'chat.attach.pick': {
        const result = options.pick?.() ?? listDto();
        current = result.attachments;
        return Promise.resolve(result);
      }
      case 'chat.attach.remove':
        current = current.filter((a) => a.id !== input.id);
        return Promise.resolve(listDto());
      case 'workspace.getState':
        return Promise.resolve({ liveTranscript: '' });
      case 'library.getMeeting':
        return Promise.resolve({ record: null });
      case 'chat.send':
        return Promise.resolve({
          status: 'answered',
          user: { id: 'u', role: 'user', text: 'q', createdAt: '2026-09-01T09:00:00Z' },
          assistant: { id: 'a', role: 'assistant', text: 'ok', createdAt: '2026-09-01T09:00:00Z' },
          notice: options.sendNotice ?? null,
        });
      default:
        return Promise.reject(new Error(`unhandled ${name}`));
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
  Object.defineProperty(window, 'vozellaFiles', {
    value: {
      attachToChat: (files: File[]) => {
        rig.dropped.push(files);
        current = [
          ...current,
          chip({ id: 'att-9', name: files[0]?.name ?? '', status: 'reading' }),
        ];
        return Promise.resolve(listDto());
      },
    },
    configurable: true,
    writable: true,
  });
  return rig;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
  Reflect.deleteProperty(window, 'vozellaFiles');
});

const mount = (locale: 'en' | 'es' = 'en') =>
  render(
    <Providers locale={locale}>
      <DialogHost>
        <ChatBody scope={MEETING} />
      </DialogHost>
    </Providers>,
  );

const chips = () => screen.getByRole('list', { name: 'Attached files' });

describe('attachment chips', () => {
  it('the paperclip opens the picker and the chips appear with kind, size and pages', async () => {
    install({
      pick: () => ({
        attachments: [
          chip(),
          chip({ id: 'att-2', name: 'deck.pptx', kind: 'pptx', pages: 1, sizeBytes: 2_400_000 }),
        ],
        notice: null,
      }),
    });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    const list = await waitFor(chips);
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('plan.pdf');
    expect(items[0]).toHaveTextContent('244 KB · 12 pages');
    expect(items[1]).toHaveTextContent('2.3 MB · 1 slide');
  });

  it('a file being read says so; a refused one shows its reason', async () => {
    install({
      list: [
        chip({ status: 'reading', pages: null }),
        chip({ id: 'att-2', name: 'tool.exe', status: 'error', message: 'Cannot attach this.' }),
      ],
    });
    mount();
    const list = await waitFor(chips);
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Reading…');
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Cannot attach this.');
  });

  it('remove takes the chip away and puts focus back in the composer', async () => {
    const rig = install({ list: [chip()] });
    mount();
    await waitFor(chips);
    await userEvent.click(screen.getByRole('button', { name: 'Remove plan.pdf' }));
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: 'Attached files' })).toBeNull();
    });
    expect(rig.inputs).toContainEqual({ name: 'chat.attach.remove', input: { id: 'att-1' } });
    expect(document.activeElement?.id).toBe('TxtMeetingChat');
  });

  it('chips follow the chat state: New chat (an empty list from main) clears them', async () => {
    const rig = install({ list: [chip()] });
    mount();
    await waitFor(chips);
    act(() => {
      rig.emit('chat.stateChanged', { state: stateOf([]) });
    });
    expect(screen.queryByRole('list', { name: 'Attached files' })).toBeNull();
  });

  it('a send carries the ids of every file that did not fail', async () => {
    const rig = install({
      list: [chip(), chip({ id: 'att-2', status: 'error', message: 'x' }), chip({ id: 'att-3' })],
    });
    mount();
    await waitFor(chips);
    await userEvent.type(screen.getByTestId('TxtMeetingChat'), 'What is the budget?{Enter}');
    await waitFor(() => {
      expect(rig.inputs.some((c) => c.name === 'chat.send')).toBe(true);
    });
    const send = rig.inputs.find((c) => c.name === 'chat.send');
    expect(send?.input.attachmentIds).toEqual(['att-1', 'att-3']);
  });

  it('an answer notice (images left out by the local model) is shown', async () => {
    install({
      list: [chip({ kind: 'image' })],
      sendNotice: 'The local model does not read images.',
    });
    mount();
    await waitFor(chips);
    await userEvent.type(screen.getByTestId('TxtMeetingChat'), 'q{Enter}');
    expect(await screen.findByText('The local model does not read images.')).toBeTruthy();
  });

  it('speaks Spanish', async () => {
    install({ list: [chip()] });
    mount('es');
    expect(await screen.findByRole('list', { name: 'Archivos adjuntos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Adjuntar archivos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitar plan.pdf' })).toBeTruthy();
  });
});

describe('drop onto the panel', () => {
  const dataTransfer = (files: File[]) => ({ files, types: ['Files'], dropEffect: 'none' });

  it('shows the drop overlay while files are dragged over, and attaches them on drop', async () => {
    const rig = install();
    mount();
    const zone = screen.getByTestId('ZoneMeetingChatDrop');
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.dragEnter(zone, { dataTransfer: dataTransfer([file]) });
    expect(screen.getByText('Drop to attach')).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer: dataTransfer([file]) });
    await waitFor(() => {
      expect(screen.queryByText('Drop to attach')).toBeNull();
    });
    expect(rig.dropped).toEqual([[file]]);
    expect(await screen.findByRole('list', { name: 'Attached files' })).toHaveTextContent(
      'notes.txt',
    );
  });

  it('ignores a drag that carries no files (text from the page)', () => {
    install();
    mount();
    const zone = screen.getByTestId('ZoneMeetingChatDrop');
    fireEvent.dragEnter(zone, { dataTransfer: { files: [], types: ['text/plain'] } });
    expect(screen.queryByText('Drop to attach')).toBeNull();
  });

  it('the overlay goes away when the drag leaves the panel', () => {
    install();
    mount();
    const zone = screen.getByTestId('ZoneMeetingChatDrop');
    fireEvent.dragEnter(zone, { dataTransfer: dataTransfer([]) });
    expect(screen.getByText('Drop to attach')).toBeTruthy();
    fireEvent.dragLeave(zone, { dataTransfer: dataTransfer([]), relatedTarget: document.body });
    expect(screen.queryByText('Drop to attach')).toBeNull();
  });
});
