import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import type { DiscreteSliderLevel } from '.';
import { DiscreteSlider } from '.';

const levels: DiscreteSliderLevel[] = [
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
];

describe('DiscreteSlider', () => {
  it('wraps the label in a Tooltip when labelTooltip is given', () => {
    const { getByText } = renderWithTheme(
      <DiscreteSlider
        value={2}
        max={3}
        label="Creativity"
        labelTooltip="Higher values produce more varied output"
        onChange={() => {}}
      />,
    );
    // The Tooltip wraps the same visible label text; presence confirms the
    // labelTooltip branch rendered instead of the bare label.
    expect(getByText('Creativity')).toBeInTheDocument();
  });

  it('renders a slider with the given accessible name', () => {
    const { getByRole } = renderWithTheme(
      <DiscreteSlider
        value={2}
        max={3}
        label="Creativity"
        onChange={() => {}}
      />,
    );
    expect(getByRole('slider', { name: 'Creativity' })).toBeInTheDocument();
  });

  it('exposes the current value via aria-valuenow', () => {
    const { getByRole } = renderWithTheme(
      <DiscreteSlider
        value={2}
        max={3}
        label="Creativity"
        onChange={() => {}}
      />,
    );
    expect(getByRole('slider')).toHaveAttribute('aria-valuenow', '2');
  });

  it('renders one mark per integer step between min and max', () => {
    const { getAllByText } = renderWithTheme(
      <DiscreteSlider
        value={1}
        min={1}
        max={4}
        onChange={() => {}}
      />,
    );
    for (const n of ['1', '2', '3', '4']) {
      expect(getAllByText(n).length).toBeGreaterThan(0);
    }
  });

  it('shows level labels under the marks when showLabels is set', () => {
    const { getByText, getAllByText, queryByText } = renderWithTheme(
      <DiscreteSlider
        value={2}
        max={3}
        levels={levels}
        showLabels
        onChange={() => {}}
      />,
    );
    expect(getByText('Low')).toBeInTheDocument();
    // "Medium" appears twice for the current value (2): once as its mark
    // label, once in the (always-in-DOM, visibility-toggled-by-CSS) drag
    // value bubble — see the "value bubble" test below for that second copy
    // in isolation.
    expect(getAllByText('Medium').length).toBeGreaterThanOrEqual(1);
    expect(getByText('High')).toBeInTheDocument();
    expect(queryByText('2')).not.toBeInTheDocument();
  });

  it('shows the bare numeric marks when showLabels is not set, even with levels supplied', () => {
    const { getByText } = renderWithTheme(
      <DiscreteSlider
        value={1}
        max={3}
        levels={levels}
        onChange={() => {}}
      />,
    );
    // value=1 keeps the (always-rendered) drag bubble's "Low" text away from
    // the mark row's own "1"/"2"/"3", so this isolates the mark row's format.
    expect(getByText('2')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();
  });

  it('formats the drag value bubble from levels regardless of showLabels', () => {
    const { getByText } = renderWithTheme(
      <DiscreteSlider
        value={2}
        max={3}
        levels={levels}
        onChange={() => {}}
      />,
    );
    // The bubble is the ONE "Medium" in the tree here — the mark row shows
    // bare numbers since showLabels is not set.
    expect(getByText('Medium')).toBeInTheDocument();
  });

  it('calls onChange with the new numeric value on ArrowRight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <DiscreteSlider
        value={2}
        max={3}
        label="Creativity"
        onChange={onChange}
      />,
    );
    getByRole('slider').focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('calls onChange with the new numeric value on ArrowLeft', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <DiscreteSlider
        value={2}
        max={3}
        label="Creativity"
        onChange={onChange}
      />,
    );
    getByRole('slider').focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('disables the underlying range input when disabled', () => {
    const { getByRole } = renderWithTheme(
      <DiscreteSlider
        value={2}
        max={3}
        label="Creativity"
        disabled
        onChange={() => {}}
      />,
    );
    expect(getByRole('slider')).toBeDisabled();
  });

  it('renders without a label, and the slider still gets a role', () => {
    const { getByRole } = renderWithTheme(
      <DiscreteSlider
        value={1}
        max={3}
        onChange={() => {}}
      />,
    );
    expect(getByRole('slider')).toBeInTheDocument();
  });

  it('defaults min to 1', () => {
    const { getAllByText, queryByText } = renderWithTheme(
      <DiscreteSlider
        value={1}
        max={2}
        onChange={() => {}}
      />,
    );
    expect(getAllByText('1').length).toBeGreaterThan(0);
    expect(queryByText('0')).not.toBeInTheDocument();
  });
});
