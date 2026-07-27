import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';

import { AppErrorBoundary } from './ErrorBoundary';

function Bomb(): never {
  throw new Error('boom from a child component');
}

describe('AppErrorBoundary', () => {
  let consoleErrorSpy: MockInstance<typeof console.error>;
  let reloadSpy: Mock<() => void>;
  let originalLocation: Location;

  beforeEach(() => {
    // React logs the caught error to console.error itself in addition to
    // componentDidCatch — spying (not just asserting call count) keeps the
    // test's own console output clean while still letting us assert on OUR
    // specific log line below.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    originalLocation = window.location;
    reloadSpy = vi.fn();
    // jsdom's window.location.reload is not implemented; replace the whole
    // object so `handleReload`'s `window.location.reload()` call is
    // observable. A minimal stub (not a spread of the real `Location`
    // instance, which loses its prototype and every accessor property) is
    // enough: AppErrorBoundary only ever calls `.reload()`.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload: reloadSpy },
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('renders children unchanged when nothing throws', () => {
    render(
      <AppErrorBoundary>
        <p>healthy child</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('healthy child')).toBeTruthy();
  });

  it('RED/GREEN (a): catches a thrown error from a child and renders the fallback instead of crashing the whole tree', () => {
    // RED case, proven inline: rendering <Bomb/> with NO boundary throws out
    // of render() and testing-library propagates it — i.e. "crashing the
    // whole tree" is real, observable behaviour for this component, not a
    // strawman. This is the exact failure AppErrorBoundary exists to stop.
    expect(() => render(<Bomb />)).toThrow('boom from a child component');

    // GREEN case: the identical throw, now wrapped, does NOT propagate —
    // render() returns normally and the fallback UI is what's on screen.
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
    expect(
      screen.getByText('An unexpected error occurred. Reloading the page usually fixes it.'),
    ).toBeTruthy();
    expect(screen.queryByText('healthy child')).toBeNull();

    // Logging: componentDidCatch's specific console.error call fired with the real Error.
    const relevantCalls = consoleErrorSpy.mock.calls.filter(
      (call) => call[0] === '[app/providers] AppErrorBoundary caught a render error',
    );
    expect(relevantCalls).toHaveLength(1);
    const [firstCall] = relevantCalls;
    const loggedError: unknown = firstCall?.[1];
    if (!(loggedError instanceof Error)) {
      throw new Error('expected componentDidCatch to log the caught Error as its second argument');
    }
    expect(loggedError.message).toBe('boom from a child component');
  });

  it('the fallback UI is announced to assistive tech and its reload button reloads the page', async () => {
    const user = userEvent.setup();
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
