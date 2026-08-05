import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useNavBlockerStore } from '../model/navBlocker.store';
import { NavBlockerDialog } from '../ui/NavBlockerDialog';
import { renderWithNavigation } from './testHarness';

beforeEach(() => {
  useNavBlockerStore.setState({ isBlockNav: false, isStreaming: false, warningMessage: 'Unsaved changes' });
});

afterEach(() => {
  useNavBlockerStore.setState({ isBlockNav: false, isStreaming: false });
});

describe('NavBlockerDialog', () => {
  it('does not block navigation when nothing is unsaved', async () => {
    const user = userEvent.setup();
    const { router } = await renderWithNavigation(<NavBlockerDialog />);
    await user.click(screen.getByText('go elsewhere'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/help-center'));
    expect(screen.queryByTestId('nav-blocker-dialog')).not.toBeInTheDocument();
  });

  it('blocks navigation and shows the confirm dialog when isBlockNav is set', async () => {
    useNavBlockerStore.setState({ isBlockNav: true, warningMessage: 'You have unsaved changes.' });
    const user = userEvent.setup();
    const { router } = await renderWithNavigation(<NavBlockerDialog />);
    await user.click(screen.getByText('go elsewhere'));
    await waitFor(() => {
      expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe('/');
  });

  it('proceeds with the navigation and clears the blocking flags on confirm', async () => {
    useNavBlockerStore.setState({ isBlockNav: true });
    const user = userEvent.setup();
    const { router } = await renderWithNavigation(<NavBlockerDialog />);
    await user.click(screen.getByText('go elsewhere'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/help-center'));
    expect(useNavBlockerStore.getState().isBlockNav).toBe(false);
  });

  it('cancels and stays on the page on close/cancel', async () => {
    useNavBlockerStore.setState({ isBlockNav: true });
    const user = userEvent.setup();
    const { router } = await renderWithNavigation(<NavBlockerDialog />);
    await user.click(screen.getByText('go elsewhere'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('nav-blocker-dialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/');
    // The blocking flag itself is untouched by cancel — old app parity (the
    // dialog only clears state on confirm; cancelling leaves you free to
    // try navigating again, or to keep editing).
    expect(useNavBlockerStore.getState().isBlockNav).toBe(true);
  });

  it('prevents beforeunload when isBlockNav is set', async () => {
    useNavBlockerStore.setState({ isBlockNav: true });
    await renderWithNavigation(<NavBlockerDialog />);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not prevent beforeunload when nothing is unsaved', async () => {
    await renderWithNavigation(<NavBlockerDialog />);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('also blocks on isStreaming alone', async () => {
    useNavBlockerStore.setState({ isStreaming: true });
    const user = userEvent.setup();
    await renderWithNavigation(<NavBlockerDialog />);
    await user.click(screen.getByText('go elsewhere'));
    await waitFor(() => {
      expect(screen.getByTestId('nav-blocker-dialog')).toBeInTheDocument();
    });
  });

  // R2 regression: `UnsavedDialog.jsx`'s `blockerFn` only ever blocks when
  // `currentLocation.pathname !== nextLocation.pathname` — a same-pathname
  // navigation (e.g. a search-param-only update, exactly what `/chat`'s
  // `edited_participant_id`/`message_id`/`name`/`shared_chat` search keys
  // do while `processes/chat/model/useStreamingNavBlocker.ts` has
  // `isStreaming` set) must be let through even while blocking is active.
  it('lets a same-pathname, search-param-only navigation through even while isBlockNav is set', async () => {
    useNavBlockerStore.setState({ isBlockNav: true, warningMessage: 'You have unsaved changes.' });
    const { router } = await renderWithNavigation(<NavBlockerDialog />);

    // Cast: this local test router's route tree only has `/` and
    // `/help-center`; `navigate`'s generic types are inferred against it
    // (see the "no explicit return-type annotation" note in
    // `testHarness.tsx`), but the `search` shape isn't declared via
    // `validateSearch` there, so a plain runtime object is the only way to
    // add an ad hoc search param without inventing a schema this harness
    // doesn't otherwise need.
    const navigate = router.navigate as unknown as (opts: { to: string; search: Record<string, string> }) => Promise<void>;
    await navigate({ to: '/', search: { probe: 'x' } });

    await waitFor(() => {
      expect(router.state.location.search).toEqual(expect.objectContaining({ probe: 'x' }));
    });
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByTestId('nav-blocker-dialog')).not.toBeInTheDocument();
    // The flag itself is untouched — this is "let through", not "confirmed".
    expect(useNavBlockerStore.getState().isBlockNav).toBe(true);
  });

  it('also lets a same-pathname, search-param-only navigation through while isStreaming is set', async () => {
    useNavBlockerStore.setState({ isStreaming: true });
    const { router } = await renderWithNavigation(<NavBlockerDialog />);
    const navigate = router.navigate as unknown as (opts: { to: string; search: Record<string, string> }) => Promise<void>;
    await navigate({ to: '/', search: { probe: 'x' } });
    await waitFor(() => {
      expect(router.state.location.search).toEqual(expect.objectContaining({ probe: 'x' }));
    });
    expect(screen.queryByTestId('nav-blocker-dialog')).not.toBeInTheDocument();
  });

  // R3 regression: the old app's `resetApiState` (`useNavBlocker.js`) is a
  // complete no-op — confirming a blocked navigation must NOT clear the
  // React Query cache.
  it('does not clear the query cache on a confirmed navigation', async () => {
    useNavBlockerStore.setState({ isBlockNav: true });
    const user = userEvent.setup();
    const { router, queryClient } = await renderWithNavigation(<NavBlockerDialog />);
    queryClient.setQueryData(['probe'], 'cached-value');

    await user.click(screen.getByText('go elsewhere'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/help-center'));

    expect(queryClient.getQueryData(['probe'])).toBe('cached-value');
  });
});
