// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip';

describe('Tooltip', () => {
  it('stacks above floating panels and wraps long text', async () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip content="A long recipe prompt that should wrap inside the popup" side="top">
          <button type="button">Chip</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByRole('button', { name: 'Chip' }));
    const popup = await screen.findByText(/long recipe prompt/);
    expect(popup.className).toContain('max-w-80');
    expect(popup.parentElement?.className).toContain('z-50');
  });
});
