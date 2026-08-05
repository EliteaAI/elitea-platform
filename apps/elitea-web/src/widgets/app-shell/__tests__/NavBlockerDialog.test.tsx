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
});
