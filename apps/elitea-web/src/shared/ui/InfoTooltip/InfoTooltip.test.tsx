import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { InfoTooltip } from '.';

describe('InfoTooltip', () => {
  it('renders as a focusable button when there is no href', () => {
    const { getByRole } = renderWithTheme(<InfoTooltip title="More info" />);
    expect(getByRole('button').tagName).toBe('BUTTON');
  });

  it('renders as a link with target=_blank when href is set', () => {
    const { getByRole } = renderWithTheme(
      <InfoTooltip
        title="More info"
        href="https://example.com"
      />,
    );
    const link = getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('gives a string title as its accessible name', () => {
    const { getByRole } = renderWithTheme(<InfoTooltip title="More info about this field" />);
    expect(getByRole('button').getAttribute('aria-label')).toBe('More info about this field');
  });

  it('falls back to a generic accessible name for a non-string title', () => {
    const { getByRole } = renderWithTheme(<InfoTooltip title={<strong>rich</strong>} />);
    expect(getByRole('button').getAttribute('aria-label')).toBe('More information');
  });

  it('shows the title in a tooltip on hover', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<InfoTooltip title="More info about this field" />);
    await user.hover(getByRole('button'));
    await waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
        'More info about this field',
      );
    });
  });

  it('renders nothing tooltip-related when disableTooltip is set, but keeps the icon', async () => {
    const user = userEvent.setup();
    const { getByRole, queryByRole } = renderWithTheme(
      <InfoTooltip
        title="More info"
        disableTooltip
      />,
    );
    await user.hover(getByRole('button'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('forwards data-testid', () => {
    const { getByTestId } = renderWithTheme(
      <InfoTooltip
        title="More info"
        data-testid="info-icon"
      />,
    );
    expect(getByTestId('info-icon')).toBeInTheDocument();
  });
});
