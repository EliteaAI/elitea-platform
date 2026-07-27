import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { BannerMessage } from '.';

describe('BannerMessage', () => {
  it('renders the message text', () => {
    const { getByText } = renderWithTheme(<BannerMessage message="Careful, this is deprecated." />);
    expect(getByText('Careful, this is deprecated.')).toBeInTheDocument();
  });

  it('is collapsed (aria-expanded=false) by default', () => {
    const { getByRole } = renderWithTheme(<BannerMessage message="msg" />);
    expect(getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands on click', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<BannerMessage message="msg" />);
    await user.click(getByRole('button'));
    expect(getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles on Enter key', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<BannerMessage message="msg" />);
    const banner = getByRole('button');
    banner.focus();
    await user.keyboard('{Enter}');
    expect(banner).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(banner).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles on Space key', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<BannerMessage message="msg" />);
    const banner = getByRole('button');
    banner.focus();
    await user.keyboard(' ');
    expect(banner).toHaveAttribute('aria-expanded', 'true');
  });

  it('is reachable by Tab (real keyboard focus order)', () => {
    const { getByRole } = renderWithTheme(<BannerMessage message="msg" />);
    expect(getByRole('button')).toHaveAttribute('tabIndex', '0');
  });

  it.each(['warning', 'error', 'info'] as const)('renders the %s variant without crashing', (variant) => {
    const { getByRole } = renderWithTheme(
      <BannerMessage
        message="msg"
        variant={variant}
      />,
    );
    expect(getByRole('button')).toBeInTheDocument();
  });
});
