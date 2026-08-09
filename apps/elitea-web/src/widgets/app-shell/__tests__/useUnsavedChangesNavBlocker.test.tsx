/**
 * Unit coverage for the setter half of the unsaved-changes guard (#133).
 * `NavBlockerDialog.test.tsx` (this same directory) covers the CONSUMING
 * half — that `isBlockNav` really blocks a router navigation and really
 * shows the dialog. What was missing from the app entirely was anything
 * that SET the flag outside `processes/chat`, which is what this hook does.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useNavBlockerStore } from '../model/navBlocker.store';
import {
  disarmUnsavedChangesNavBlocker,
  UNSAVED_CHANGES_WARNING,
  useUnsavedChangesNavBlocker,
} from '../model/useUnsavedChangesNavBlocker';

beforeEach(() => {
  useNavBlockerStore.setState({ isBlockNav: false, warningMessage: 'untouched' });
});

afterEach(() => {
  useNavBlockerStore.setState({ isBlockNav: false });
});

describe('useUnsavedChangesNavBlocker', () => {
  it('leaves the guard down while the editor is clean', () => {
    renderHook(({ dirty }) => useUnsavedChangesNavBlocker(dirty), { initialProps: { dirty: false } });
    expect(useNavBlockerStore.getState().isBlockNav).toBe(false);
  });

  it('arms the guard, with the shared warning, as soon as the editor is dirty', () => {
    renderHook(({ dirty }) => useUnsavedChangesNavBlocker(dirty), { initialProps: { dirty: true } });
    expect(useNavBlockerStore.getState().isBlockNav).toBe(true);
    expect(useNavBlockerStore.getState().warningMessage).toBe(UNSAVED_CHANGES_WARNING);
  });

  it('follows the editor back to clean when the edit is undone', () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesNavBlocker(dirty), {
      initialProps: { dirty: false },
    });
    rerender({ dirty: true });
    expect(useNavBlockerStore.getState().isBlockNav).toBe(true);
    rerender({ dirty: false });
    expect(useNavBlockerStore.getState().isBlockNav).toBe(false);
  });

  it('disarms on unmount so a dirty editor cannot leave the whole app blocked', () => {
    const { unmount } = renderHook(({ dirty }) => useUnsavedChangesNavBlocker(dirty), {
      initialProps: { dirty: true },
    });
    expect(useNavBlockerStore.getState().isBlockNav).toBe(true);
    unmount();
    expect(useNavBlockerStore.getState().isBlockNav).toBe(false);
  });

  it('honours a caller-supplied warning message', () => {
    renderHook(() => useUnsavedChangesNavBlocker(true, 'Your pipeline has unsaved changes.'));
    expect(useNavBlockerStore.getState().warningMessage).toBe('Your pipeline has unsaved changes.');
  });
});

describe('disarmUnsavedChangesNavBlocker', () => {
  it('lowers the guard for a save/discard the user already decided on', () => {
    renderHook(() => useUnsavedChangesNavBlocker(true));
    expect(useNavBlockerStore.getState().isBlockNav).toBe(true);
    disarmUnsavedChangesNavBlocker();
    expect(useNavBlockerStore.getState().isBlockNav).toBe(false);
  });

  it('is not undone by a re-render at the same dirty value', () => {
    // The regression this guards: if the effect re-ran on every render it
    // would re-arm behind a post-save `navigate(...)` and prompt about
    // changes already persisted.
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesNavBlocker(dirty), {
      initialProps: { dirty: true },
    });
    disarmUnsavedChangesNavBlocker();
    rerender({ dirty: true });
    expect(useNavBlockerStore.getState().isBlockNav).toBe(false);
  });
});
