// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Splitter } from './Splitter';

afterEach(cleanup);

describe('Splitter with the fixed pane at the end', () => {
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;

  const mount = (props: Partial<Parameters<typeof Splitter>[0]> = {}) => {
    const onSizeChange = vi.fn();
    const view = render(
      <Splitter
        label="Resize panel"
        fixedPane="end"
        defaultSize={380}
        initialSize={420}
        minSize={320}
        maxSize={520}
        onSizeChange={onSizeChange}
        first={<div>content</div>}
        second={<div>panel</div>}
        {...props}
      />,
    );
    return { ...view, onSizeChange };
  };

  it('puts the fixed pane last and sizes it from the initial size', () => {
    mount();
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    const panel = screen.getByText('panel').parentElement;
    expect(handle.getAttribute('aria-valuenow')).toBe('420');
    expect(handle.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.style.width).toBe('420px');
    expect(handle.nextElementSibling).toBe(panel);
  });

  it('grows with ArrowLeft and restores the default size on double click', async () => {
    const { onSizeChange } = mount();
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(handle.getAttribute('aria-valuenow')).toBe('436');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(handle.getAttribute('aria-valuenow')).toBe('404');
    await userEvent.dblClick(handle);
    expect(handle.getAttribute('aria-valuenow')).toBe('380');
    expect(onSizeChange).toHaveBeenLastCalledWith(380);
  });

  it('drops the handle and the pane box while collapsed, keeping the content mounted', () => {
    const { rerender } = mount({ collapsed: true });
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByText('panel').parentElement?.style.width).toBe('');
    rerender(
      <Splitter
        label="Resize panel"
        fixedPane="end"
        defaultSize={380}
        minSize={320}
        maxSize={520}
        first={<div>content</div>}
        second={<div>panel</div>}
      />,
    );
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });
});
