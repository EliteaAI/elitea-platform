import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { SimpleSearchBar } from '.';

/**
 * Real-timer sleep. `userEvent.type` under `vi.useFakeTimers()` combined
 * with `advanceTimers` reliably hangs the test runner here (verified: every
 * test using that combination timed out at the harness's 5000ms limit,
 * every test using real timers did not) — so debounce timing is exercised
 * with short real delays instead of faking the clock.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SimpleSearchBar', () => {
  it('renders the current value', () => {
    const { getByDisplayValue } = renderWithTheme(
      <SimpleSearchBar
        value="hello"
        onChange={() => {}}
      />,
    );
    expect(getByDisplayValue('hello')).toBeInTheDocument();
  });

  it('renders the default placeholder', () => {
    const { getByPlaceholderText } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={() => {}}
      />,
    );
    expect(getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('renders a custom placeholder', () => {
    const { getByPlaceholderText } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={() => {}}
        placeholder="Find a tool"
      />,
    );
    expect(getByPlaceholderText('Find a tool')).toBeInTheDocument();
  });

  it('updates the displayed value synchronously (before the debounce fires)', async () => {
    const user = userEvent.setup();
    const { getByDisplayValue } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={() => {}}
        debounceMs={1000}
      />,
    );
    await user.type(getByDisplayValue(''), 'a');
    expect(getByDisplayValue('a')).toBeInTheDocument();
  });

  it('debounces onChange: does not call it before debounceMs elapses', async () => {
    // debounceMs=500 (well above the ~50ms userEvent.type overhead this
    // assertion has to outrun) rather than the original 200: this specific
    // test's whole purpose is the immediate not-yet-called check, so unlike
    // the two tests below it, there's no eventual-call assertion to fall
    // back on that would make the immediate one droppable -- it needs a
    // real margin instead, given the flakiness already observed at both
    // 30ms (CodeMirrorEditor) and effectively ~50ms (this file's own
    // "resets the debounce timer" test) real-timer windows elsewhere.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByDisplayValue } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={onChange}
        debounceMs={500}
      />,
    );
    await user.type(getByDisplayValue(''), 'a');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('debounces onChange: calls it once, with the latest value, after debounceMs elapses', async () => {
    // Deliberately does NOT also assert `not.toHaveBeenCalled()` immediately
    // after typing (that raced the 100ms debounce window against
    // userEvent's own real inter-action delays -- the same class of CI-only
    // intermittent failure fixed elsewhere in this file and in
    // CodeMirrorEditor.test.tsx): the eventual toHaveBeenCalledTimes(1) +
    // toHaveBeenCalledWith('ab') below already fully proves debouncing
    // happened (a non-debounced or multiply-firing implementation could not
    // produce exactly one call with the final coalesced value), so the
    // immediate check added no coverage the final one doesn't already give,
    // only a race.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByDisplayValue } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={onChange}
        debounceMs={100}
      />,
    );
    const input = getByDisplayValue('');
    await user.type(input, 'ab');
    await sleep(200);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ab');
  });

  it('resets the debounce timer on every keystroke (trailing-edge only)', async () => {
    // Deliberately does NOT assert `not.toHaveBeenCalled()` at a calculated
    // mid-flight instant (100ms after the second keystroke, before the
    // second keystroke's own 150ms window elapses): that raced real
    // wall-clock time against userEvent's own real inter-action delays, and
    // was observed to fail intermittently on a slower CI runner where the
    // cumulative delay alone could close the ~50ms margin. The behaviour
    // this test exists to prove -- that each keystroke's setTimeout clears
    // the PREVIOUS one (SimpleSearchBar.tsx's `clearTimeout(timeoutRef.
    // current)` before scheduling a new one) -- is instead proven
    // deterministically: if that clearTimeout were ever removed, the first
    // keystroke's stale timer would still fire on its own, producing a
    // SECOND, extra onChange('a') call in addition to the real onChange
    // ('ab') call. Checking the final call count once everything has long
    // since settled catches that regression exactly as precisely, with no
    // timing race at all.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByDisplayValue } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={onChange}
        debounceMs={150}
      />,
    );
    const input = getByDisplayValue('');
    await user.type(input, 'a');
    await sleep(100);
    await user.type(input, 'b');
    await sleep(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ab');
  });

  it('calls onChange synchronously (no debounce) when debounceMs is 0', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByDisplayValue } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={onChange}
        debounceMs={0}
      />,
    );
    await user.type(getByDisplayValue(''), 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('Escape clears immediately, bypassing any pending debounce', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByDisplayValue } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={onChange}
        debounceMs={200}
      />,
    );
    const input = getByDisplayValue('');
    await user.type(input, 'abc');
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onChange).toHaveBeenCalledWith('');
    expect(getByDisplayValue('')).toBeInTheDocument();
    // The pending debounce from typing "abc" must have been cancelled —
    // waiting past its delay must not produce a second, stale call.
    await sleep(300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onClear when provided', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const { getByDisplayValue } = renderWithTheme(
      <SimpleSearchBar
        value="q"
        onChange={() => {}}
        onClear={onClear}
      />,
    );
    getByDisplayValue('q').focus();
    await user.keyboard('{Escape}');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('syncs the draft when the value prop changes externally', () => {
    const { getByDisplayValue, rerender } = renderWithTheme(
      <SimpleSearchBar
        value="first"
        onChange={() => {}}
      />,
    );
    expect(getByDisplayValue('first')).toBeInTheDocument();
    rerender(
      <SimpleSearchBar
        value="second"
        onChange={() => {}}
      />,
    );
    expect(getByDisplayValue('second')).toBeInTheDocument();
  });

  it('clears any pending debounce timer on unmount (no post-unmount onChange call)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByDisplayValue, unmount } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={onChange}
        debounceMs={150}
      />,
    );
    await user.type(getByDisplayValue(''), 'a');
    unmount();
    await sleep(250);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards data-testid onto the native input', () => {
    const { getByTestId } = renderWithTheme(
      <SimpleSearchBar
        value=""
        onChange={() => {}}
        data-testid="search-input"
      />,
    );
    expect(getByTestId('search-input')).toBeInTheDocument();
  });
});
