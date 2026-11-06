// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { MarkdownView } from './MarkdownView';

afterEach(cleanup);

describe('MarkdownView', () => {
  it('renders headings, lists, emphasis, code and a table', () => {
    render(
      <MarkdownView
        source={'# Title\n\n- **a**\n- *b*\n\n`x`\n\n| N | D |\n|---|---|\n| Ana | Mon |'}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'N' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Ana' })).toBeTruthy();
  });

  it('shows raw HTML as text', () => {
    const { container } = render(
      <MarkdownView source={'<img src=x onerror=alert(1)> <b>hi</b>'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>hi</b>');
  });

  it('puts the visible target in the title and hands clicks to onLink', async () => {
    const onLink = vi.fn();
    render(<MarkdownView source="[site](https://example.com/a)" onLink={onLink} />);
    const link = screen.getByRole('link', { name: 'site' });
    expect(link.getAttribute('title')).toBe('https://example.com/a');
    await userEvent.click(link);
    expect(onLink).toHaveBeenCalledWith('https://example.com/a', expect.anything());
  });

  it('renders an unsafe link as plain text', () => {
    render(<MarkdownView source="[go](javascript:alert(1))" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('go')).toBeTruthy();
  });

  it('does not throw on a partial answer', () => {
    for (const source of ['**bold', '```\nfence', '[a](https://x', '| a | b |\n|---']) {
      expect(() => render(<MarkdownView source={source} />)).not.toThrow();
    }
  });
});

describe('MarkdownView time citations (T3)', () => {
  const ID = '0123456789abcdef0123456789abcdef';
  it('renders a moment citation as a chip named for the transcript', async () => {
    const onLink = vi.fn((_href: string, event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <I18nProvider>
        <MarkdownView
          source={`Budget rises [12:05](https://meetinglive.local/meeting/${ID}?t=725).`}
          onLink={onLink}
        />
      </I18nProvider>,
    );
    const chip = screen.getByRole('link', { name: 'Go to 12:05 in the transcript' });
    expect(chip.textContent).toContain('12:05');
    expect(chip.className).toContain('rounded-control');
    expect(chip.getAttribute('data-citation')).toBe('time');
    await userEvent.click(chip);
    expect(onLink).toHaveBeenCalledWith(
      `https://meetinglive.local/meeting/${ID}?t=725`,
      expect.anything(),
    );
  });

  it('a meeting citation without a moment stays a plain link', () => {
    render(
      <I18nProvider>
        <MarkdownView source={`See [Sprint, Sep 1](https://meetinglive.local/meeting/${ID}).`} />
      </I18nProvider>,
    );
    const link = screen.getByRole('link', { name: 'Sprint, Sep 1' });
    expect(link.getAttribute('data-citation')).toBeNull();
  });
});
