import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../../lib/testTheme';
import { CronFieldGrid } from '../CronFieldGrid';
import { DEFAULT_EXPRESSION_STATE } from '../model';

describe('CronFieldGrid', () => {
  it('renders all five fields with their labels', () => {
    renderWithTheme(<CronFieldGrid state={DEFAULT_EXPRESSION_STATE} onFieldChange={vi.fn()} disabled={false} />);
    expect(screen.getByText('Minute')).toBeInTheDocument();
    expect(screen.getByText('Hour')).toBeInTheDocument();
    expect(screen.getByText('Day of month')).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
    expect(screen.getByText('Day of week')).toBeInTheDocument();
  });

  it('routes a field edit to onFieldChange tagged with the right fieldId', async () => {
    const user = userEvent.setup();
    const onFieldChange = vi.fn();
    renderWithTheme(<CronFieldGrid state={DEFAULT_EXPRESSION_STATE} onFieldChange={onFieldChange} />);

    const monthGroup = screen.getByRole('group', { name: 'Month' });
    await user.click(within(monthGroup).getByRole('button', { name: 'Specific' }));

    expect(onFieldChange).toHaveBeenCalledWith('month', { kind: 'list', values: [1] });
  });

  it('renders weekday values with short weekday names, not raw numbers', () => {
    renderWithTheme(
      <CronFieldGrid
        state={{ ...DEFAULT_EXPRESSION_STATE, dayOfWeek: { kind: 'list', values: [6] } }}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Sat')).toBeInTheDocument();
  });

  it('renders month values with short month names, not raw numbers', () => {
    renderWithTheme(
      <CronFieldGrid
        state={{ ...DEFAULT_EXPRESSION_STATE, month: { kind: 'list', values: [12] } }}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Dec')).toBeInTheDocument();
  });
});
