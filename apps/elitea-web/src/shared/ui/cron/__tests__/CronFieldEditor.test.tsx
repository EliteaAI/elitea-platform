import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../../lib/testTheme';
import { CronFieldEditor, normalizeSelectMultipleValue } from '../CronFieldEditor';
import { weekdayShortLabel } from '../labels';
import { CRON_FIELD_BOUNDS } from '../model';

describe('CronFieldEditor — kind switching', () => {
  it('renders no value picker for the "every" kind', () => {
    renderWithTheme(
      <CronFieldEditor
        fieldId="minute"
        label="Minute"
        bounds={CRON_FIELD_BOUNDS.minute}
        state={{ kind: 'every' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Every' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to "list" and reports a one-element default list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="minute"
        label="Minute"
        bounds={CRON_FIELD_BOUNDS.minute}
        state={{ kind: 'every' }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Specific' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'list', values: [0] });
  });

  it('switches to "range" and reports a two-value default range clamped to bounds', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="month"
        label="Month"
        bounds={CRON_FIELD_BOUNDS.month}
        state={{ kind: 'every' }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Range' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'range', from: 1, to: 2 });
  });

  it('switches to "step" and reports the field\'s default step, clamped to bounds.max', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="dayOfWeek"
        label="Day of week"
        bounds={CRON_FIELD_BOUNDS.dayOfWeek}
        state={{ kind: 'every' }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Every N' }));
    // dayOfWeek.defaultStep is 2, well under its max (6) — no clamping needed.
    expect(onChange).toHaveBeenCalledWith({ kind: 'step', step: 2 });
  });

  it('does not call onChange when the already-active kind button is clicked again (deselect)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="minute"
        label="Minute"
        bounds={CRON_FIELD_BOUNDS.minute}
        state={{ kind: 'every' }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Every' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables the kind toggle group when disabled', () => {
    renderWithTheme(
      <CronFieldEditor
        fieldId="minute"
        label="Minute"
        bounds={CRON_FIELD_BOUNDS.minute}
        state={{ kind: 'every' }}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole('button', { name: 'Every' })).toBeDisabled();
  });
});

describe('CronFieldEditor — "list" value picker', () => {
  it('renders the current values as chips, using optionLabel when provided', () => {
    renderWithTheme(
      <CronFieldEditor
        fieldId="dayOfWeek"
        label="Day of week"
        bounds={CRON_FIELD_BOUNDS.dayOfWeek}
        state={{ kind: 'list', values: [1, 6] }}
        onChange={vi.fn()}
        optionLabel={weekdayShortLabel}
      />,
    );
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();
  });

  it('adds a newly-selected option to the list, sorted ascending', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="minute"
        label="Minute"
        bounds={CRON_FIELD_BOUNDS.minute}
        state={{ kind: 'list', values: [30] }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Values' }));
    await user.click(await screen.findByRole('option', { name: '5' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'list', values: [5, 30] });
  });
});

describe('CronFieldEditor — "range" value picker', () => {
  it('renders From/To selects with the current bounds', () => {
    renderWithTheme(
      <CronFieldEditor
        fieldId="hour"
        label="Hour"
        bounds={CRON_FIELD_BOUNDS.hour}
        state={{ kind: 'range', from: 9, to: 17 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveTextContent('9');
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveTextContent('17');
  });

  it('changing "From" past the current "To" pulls "To" up to match', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="hour"
        label="Hour"
        bounds={CRON_FIELD_BOUNDS.hour}
        state={{ kind: 'range', from: 1, to: 5 }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'From' }));
    await user.click(await screen.findByRole('option', { name: '10' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'range', from: 10, to: 10 });
  });

  it('changing "To" below the current "From" pulls "From" down to match', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="hour"
        label="Hour"
        bounds={CRON_FIELD_BOUNDS.hour}
        state={{ kind: 'range', from: 10, to: 15 }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'To' }));
    await user.click(await screen.findByRole('option', { name: '3' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'range', from: 3, to: 3 });
  });

  it('changing "From" to a value still below "To" leaves "To" untouched', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="hour"
        label="Hour"
        bounds={CRON_FIELD_BOUNDS.hour}
        state={{ kind: 'range', from: 1, to: 20 }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'From' }));
    await user.click(await screen.findByRole('option', { name: '5' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'range', from: 5, to: 20 });
  });
});

describe('CronFieldEditor — "step" value picker', () => {
  it('renders the current step value', () => {
    renderWithTheme(
      <CronFieldEditor
        fieldId="minute"
        label="Minute"
        bounds={CRON_FIELD_BOUNDS.minute}
        state={{ kind: 'step', step: 15 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Every' })).toHaveTextContent('15');
  });

  it('reports the newly-selected step', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="minute"
        label="Minute"
        bounds={CRON_FIELD_BOUNDS.minute}
        state={{ kind: 'step', step: 5 }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Every' }));
    await user.click(await screen.findByRole('option', { name: '20' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'step', step: 20 });
  });

  it('deselecting the only value does not call onChange (a field must keep at least one value)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithTheme(
      <CronFieldEditor
        fieldId="minute"
        label="Minute"
        bounds={CRON_FIELD_BOUNDS.minute}
        state={{ kind: 'list', values: [30] }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Values' }));
    // Clicking the only selected option again deselects it -> value: [].
    await user.click(await screen.findByRole('option', { name: '30' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('normalizeSelectMultipleValue', () => {
  it('sorts an array input ascending', () => {
    expect(normalizeSelectMultipleValue([10, 2, 30])).toEqual([2, 10, 30]);
  });

  it('parses and sorts a comma-joined string input (the native-multi-select union member)', () => {
    expect(normalizeSelectMultipleValue('10,2,30')).toEqual([2, 10, 30]);
  });

  it('returns an empty array for an empty string', () => {
    expect(normalizeSelectMultipleValue('')).toEqual([]);
  });

  it('returns an empty array for an empty array', () => {
    expect(normalizeSelectMultipleValue([])).toEqual([]);
  });
});
