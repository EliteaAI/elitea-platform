import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { InfoLabelWithTooltip } from '.';

describe('InfoLabelWithTooltip', () => {
  it('renders the label text', () => {
    const { getByText } = renderWithTheme(<InfoLabelWithTooltip label="Field name" />);
    expect(getByText('Field name')).toBeInTheDocument();
  });

  it('does not render an info icon when no tooltip is given', () => {
    const { container } = renderWithTheme(<InfoLabelWithTooltip label="Field name" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders an info icon when a tooltip is given', () => {
    const { container } = renderWithTheme(
      <InfoLabelWithTooltip
        label="Field name"
        tooltip="More detail about this field"
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('shows the tooltip content on hover', async () => {
    const user = userEvent.setup();
    const { container } = renderWithTheme(
      <InfoLabelWithTooltip
        label="Field name"
        tooltip="More detail about this field"
      />,
    );
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    await user.hover(icon as Element);
    await waitFor(() => {
      expect(document.body).toHaveTextContent('More detail about this field');
    });
  });

  it('appends a trailing asterisk to a string label when required', () => {
    const { getByText } = renderWithTheme(
      <InfoLabelWithTooltip
        label="Field name"
        required
      />,
    );
    expect(getByText('Field name *')).toBeInTheDocument();
  });

  it('does not mutate a non-string label when required is set', () => {
    const { getByText } = renderWithTheme(
      <InfoLabelWithTooltip
        label={<span>Node label</span>}
        required
      />,
    );
    expect(getByText('Node label')).toBeInTheDocument();
  });

  it('renders as an inline span instead of Typography when inline is set', () => {
    const { getByText } = renderWithTheme(
      <InfoLabelWithTooltip
        label="Inline label"
        inline
      />,
    );
    const node = getByText('Inline label');
    expect(node.tagName).toBe('SPAN');
    expect(node.className).not.toContain('MuiTypography');
  });

  it('renders as Typography by default (not inline)', () => {
    const { getByText } = renderWithTheme(<InfoLabelWithTooltip label="Typography label" />);
    expect(getByText('Typography label').className).toContain('MuiTypography');
  });

  it('applies the requested typography variant', () => {
    const { getByText } = renderWithTheme(
      <InfoLabelWithTooltip
        label="Variant label"
        variant="headingSmall"
      />,
    );
    expect(getByText('Variant label')).toHaveClass('MuiTypography-headingSmall');
  });
});
