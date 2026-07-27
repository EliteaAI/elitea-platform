import { useState } from 'react';

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../../lib/testTheme';
import { CronField } from '../CronField';

function ControlledCronField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <CronField value={value} onChange={setValue} />;
}

describe('CronField — rendering a valid expression', () => {
  it('shows the matching preset and the human-readable preview', () => {
    renderWithTheme(<CronField value="0 0 * * 6" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent('Every Saturday at midnight');
    // The preview lives in the <output role="status"> — scoped explicitly
    // because the preset dropdown can independently render the same text
    // (e.g. once "Every minute" is both the active preset's label and the
    // preview, see the end-to-end test below).
    expect(screen.getByRole('status')).toHaveTextContent('At 00:00, only on Saturday');
  });

  it('renders the field-order caption', () => {
    renderWithTheme(<CronField value="0 0 * * 6" onChange={vi.fn()} />);
    expect(screen.getByText('minute – hour – day (month) – month – day (week)')).toBeInTheDocument();
  });

  it('applies the supplied id to the root element', () => {
    renderWithTheme(<CronField value="0 0 * * 6" onChange={vi.fn()} id="schedule-cron" />);
    expect(document.getElementById('schedule-cron')).toBeInTheDocument();
  });
});

describe('CronField — rendering an invalid expression', () => {
  it('shows the parse error in place of the preview, and no active preset', () => {
    renderWithTheme(<CronField value="not a cron" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent('Custom');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Cron must have exactly 5 parts with space between every part',
    );
  });

  it('still renders the field grid using a safe all-"every" fallback state', () => {
    renderWithTheme(<CronField value="not a cron" onChange={vi.fn()} />);
    const minuteGroup = screen.getByRole('group', { name: 'Minute' });
    expect(within(minuteGroup).getByRole('button', { name: 'Every' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('CronField — editing', () => {
  it('selecting a preset calls onChange with that preset\'s expression', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(<CronField value="0 0 * * 6" onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Preset' }));
    await user.click(await screen.findByRole('option', { name: 'Every hour' }));

    expect(onChange).toHaveBeenCalledWith('0 * * * *');
  });

  it('editing one field re-serialises the whole expression, leaving the other fields untouched', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(<CronField value="0 0 * * 6" onChange={onChange} />);

    const hourGroup = screen.getByRole('group', { name: 'Hour' });
    await user.click(within(hourGroup).getByRole('button', { name: 'Every' }));

    // minute/dayOfWeek stay "0"/"6"; only hour flips from "0" to "*".
    expect(onChange).toHaveBeenCalledWith('0 * * * 6');
  });

  it('end to end: selecting a preset updates the rendered preview text', async () => {
    const user = userEvent.setup();
    renderWithTheme(<ControlledCronField initial="0 0 * * 6" />);

    expect(screen.getByRole('status')).toHaveTextContent('At 00:00, only on Saturday');

    await user.click(screen.getByRole('combobox', { name: 'Preset' }));
    await user.click(await screen.findByRole('option', { name: 'Every minute' }));

    expect(screen.getByRole('status')).toHaveTextContent('Every minute');
  });
});
