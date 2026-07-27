import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ConfirmRedirectModal } from '../ui/ConfirmRedirectModal';

beforeEach(() => {
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConfirmRedirectModal', () => {
  it('shows the toolkit name and description when open', () => {
    renderWithTheme(
      <ConfirmRedirectModal
        open
        toolkitName="Jira"
        toolkitDescription="Project tracker"
        redirectUrl="https://example.com"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Jira/)).toBeInTheDocument();
    expect(screen.getByText('Project tracker')).toBeInTheDocument();
  });

  it('falls back to "This application" when no toolkit name is given', () => {
    renderWithTheme(
      <ConfirmRedirectModal
        open
        redirectUrl="https://example.com"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/This application/)).toBeInTheDocument();
  });

  it('opens the redirect URL in a new tab and closes on confirm', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithTheme(
      <ConfirmRedirectModal
        open
        redirectUrl="https://example.com/tool"
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open in New Tab' }));
    expect(window.open).toHaveBeenCalledWith('https://example.com/tool', '_blank', 'noopener,noreferrer');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without opening a tab on cancel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithTheme(
      <ConfirmRedirectModal
        open
        redirectUrl="https://example.com/tool"
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.open).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens the redirect URL on a global Enter keydown while open', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <ConfirmRedirectModal
        open
        redirectUrl="https://example.com/tool"
        onClose={vi.fn()}
      />,
    );
    await user.keyboard('{Enter}');
    expect(window.open).toHaveBeenCalledWith('https://example.com/tool', '_blank', 'noopener,noreferrer');
  });

  it('closes on a global Escape keydown while open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithTheme(
      <ConfirmRedirectModal
        open
        redirectUrl="https://example.com/tool"
        onClose={onClose}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does not attach a global keydown listener while closed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithTheme(
      <ConfirmRedirectModal
        open={false}
        redirectUrl="https://example.com/tool"
        onClose={onClose}
      />,
    );
    await user.keyboard('{Enter}');
    expect(window.open).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing interactive when closed', () => {
    renderWithTheme(
      <ConfirmRedirectModal
        open={false}
        redirectUrl="https://example.com"
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Open in New Tab' })).not.toBeInTheDocument();
  });
});
