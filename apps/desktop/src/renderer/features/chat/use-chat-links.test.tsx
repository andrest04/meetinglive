// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { MarkdownView } from '../summaries/MarkdownView';
import { classifyChatLink, useChatLinks } from './use-chat-links';

const ID = 'a0000000000040008000000000000000';
const calls: { channel: string; input: unknown }[] = [];
let existing: string | null = ID;
let openFailure: string | null = null;
let throwOn: string | null = null;

beforeEach(() => {
  calls.length = 0;
  existing = ID;
  openFailure = null;
  throwOn = null;
  (window as unknown as { vozella: unknown }).vozella = {
    invoke: (channel: string, input: unknown) => {
      calls.push({ channel, input });
      if (channel === throwOn) return Promise.reject(new Error('boom'));
      if (channel === 'chat.meetingExists') {
        return Promise.resolve({ exists: existing !== null, meetingId: existing });
      }
      if (channel === 'chat.openExternal') {
        return Promise.resolve(
          openFailure === null ? { status: 'opened' } : { status: 'failed', detail: openFailure },
        );
      }
      return Promise.resolve({});
    },
    on: () => () => undefined,
  };
});
afterEach(cleanup);

function Harness({ source, report }: { source: string; report: (m: string) => void }) {
  const onLink = useChatLinks(report);
  return <MarkdownView source={source} onLink={onLink} />;
}
const show = (source: string) => {
  const report = vi.fn();
  render(
    <Providers>
      <Harness source={source} report={report} />
    </Providers>,
  );
  return report;
};

describe('classifyChatLink', () => {
  it.each([
    [`https://meetinglive.local/meeting/${ID}`, 'meeting'],
    [`https://meetinglive.local/meeting/${ID}/`, 'meeting'],
    ['https://MeetingLive.local/meeting/a0000000-0000-4000-8000-000000000000', 'meeting'],
    ['https://example.com/x', 'external'],
    ['javascript:alert(1)', 'ignored'],
    ['file:///c:/x', 'ignored'],
    ['custom://thing', 'ignored'],
    ['', 'ignored'],
  ])('%s is %s', (href, kind) => {
    expect(classifyChatLink(href).kind).toBe(kind);
  });
});

describe('useChatLinks', () => {
  it('selects the meeting and opens its Summary tab', async () => {
    show(`[m](https://meetinglive.local/meeting/${ID})`);
    fireEvent.click(screen.getByRole('link', { name: 'm' }));
    await waitFor(() => {
      expect(calls.map((c) => c.channel)).toEqual([
        'chat.meetingExists',
        'workspace.dispatch',
        'workspace.dispatch',
      ]);
    });
    expect(calls[1]?.input).toEqual({ action: { type: 'selectMeeting', id: ID } });
    expect(calls[2]?.input).toEqual({ action: { type: 'openSession', tab: 'Summary' } });
  });

  it('reports a missing meeting and does not navigate', async () => {
    existing = null;
    const report = show(`[m](https://meetinglive.local/meeting/${ID})`);
    fireEvent.click(screen.getByRole('link', { name: 'm' }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith('That meeting no longer exists.');
    });
    expect(calls.some((c) => c.channel === 'workspace.dispatch')).toBe(false);
  });

  it('gives an unknown braced id the missing message', async () => {
    existing = null;
    const report = show(
      '[m](https://meetinglive.local/meeting/{a0000000-0000-4000-8000-000000000001})',
    );
    fireEvent.click(screen.getByRole('link', { name: 'm' }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith('That meeting no longer exists.');
    });
    expect(calls[0]?.input).toEqual({ meetingId: 'a0000000000040008000000000000001' });
  });

  it('opens a web link in the system browser, trailing slash kept', async () => {
    show('[w](https://example.com/docs/)');
    fireEvent.click(screen.getByRole('link', { name: 'w' }));
    await waitFor(() => {
      expect(calls).toEqual([
        { channel: 'chat.openExternal', input: { url: 'https://example.com/docs/' } },
      ]);
    });
  });

  it('does nothing for javascript: and renders it as text', () => {
    show('[x](javascript:alert(1))');
    expect(screen.queryByRole('link')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('reports an opener failure and a thrown error', async () => {
    openFailure = 'no browser';
    const report = show('[w](https://example.com/)');
    fireEvent.click(screen.getByRole('link', { name: 'w' }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith('Could not answer. no browser');
    });
    throwOn = 'chat.openExternal';
    fireEvent.click(screen.getByRole('link', { name: 'w' }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith('Could not answer. boom');
    });
  });

  it('works on a partial answer that is still streaming', async () => {
    show(`Intro [m](https://meetinglive.local/meeting/${ID}) and **unfinished [x](`);
    fireEvent.click(screen.getByRole('link', { name: 'm' }));
    await waitFor(() => {
      expect(calls).toHaveLength(3);
    });
  });
});
