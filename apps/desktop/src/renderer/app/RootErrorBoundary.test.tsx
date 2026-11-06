// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootErrorBoundary, RouteCrash } from './RootErrorBoundary';

function Boom(): never {
  throw new Error('kaboom');
}

beforeEach(() => {
  // React logs caught render errors; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  document.documentElement.lang = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RootErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <RootErrorBoundary locale="en">
        <p>fine</p>
      </RootErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('shows a localized fallback with the error message instead of a blank window', () => {
    const onError = vi.fn();
    render(
      <RootErrorBoundary locale="en" showDetails onError={onError}>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByText('kaboom')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'kaboom' }));
  });

  it('hides the error message outside development', () => {
    render(
      <RootErrorBoundary locale="en" showDetails={false}>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.queryByText('kaboom')).not.toBeInTheDocument();
  });

  it('follows the language the app last showed', () => {
    document.documentElement.lang = 'es';
    render(
      <RootErrorBoundary locale="en">
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Algo salió mal');
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
  });

  it('reloads the window from the fallback', async () => {
    const onReload = vi.fn();
    render(
      <RootErrorBoundary locale="en" onReload={onReload}>
        <Boom />
      </RootErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('RouteCrash', () => {
  it('shows the same fallback for an error the router caught', () => {
    render(<RouteCrash error={new Error('route broke')} reset={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
