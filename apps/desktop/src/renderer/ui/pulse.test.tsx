// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PULSE_PERIOD, PULSE_STATIC_OPACITY, Pulse } from './Pulse';

const motion = (reduced: boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
};

afterEach(cleanup);

describe('Pulse', () => {
  it('animates the halo between 0.15 and 0.45 over 1.2 s, reversing', () => {
    motion(false);
    render(<Pulse active />);
    const halo = screen.getByTestId('pulse-halo');
    expect(PULSE_PERIOD).toBe('1.2s');
    expect(halo.style.animation).toContain('halo-pulse 1.2s');
    expect(halo.style.animation).toContain('infinite');
    expect(halo.style.animation).toContain('alternate');
  });

  it('is a static 0.3 under reduced motion', () => {
    motion(true);
    render(<Pulse active />);
    const halo = screen.getByTestId('pulse-halo');
    expect(PULSE_STATIC_OPACITY).toBe(0.3);
    expect(halo.style.opacity).toBe('0.3');
    expect(halo.style.animation).toBe('none');
  });

  it('has no halo when paused or not recording', () => {
    motion(false);
    render(<Pulse active={false} />);
    const halo = screen.getByTestId('pulse-halo');
    expect(halo.style.opacity).toBe('0');
    expect(halo.style.animation).toBe('');
  });

  it('is decorative', () => {
    motion(false);
    render(<Pulse active />);
    expect(screen.getByTestId('pulse')).toHaveAttribute('aria-hidden', 'true');
  });
});
