import type { ReactElement } from 'react';

import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { DateRangeField } from './DateRangeField';

/**
 * `DateRangeField` requires a `LocalizationProvider` ancestor (it does not
 * supply its own — `AnalyticsContainer`, its only real caller, provides
 * exactly one for both `From:`/`To:` fields, per that component's own
 * header comment on why this app self-provisions the provider locally).
 */
function renderField(ui: ReactElement): RenderResult {
  return renderWithTheme(<LocalizationProvider dateAdapter={AdapterDateFns}>{ui}</LocalizationProvider>);
}

describe('DateRangeField', () => {
  it('renders the label', () => {
    const { getByText } = renderField(
      <DateRangeField
        label="From:"
        value={new Date('2026-07-20T00:00:00.000Z')}
        onChange={() => {}}
        open={false}
        onOpen={() => {}}
        onClose={() => {}}
      />,
    );
    expect(getByText('From:')).toBeInTheDocument();
  });

  it('renders the picker input with the formatted value', () => {
    const { container } = renderField(
      <DateRangeField
        label="From:"
        value={new Date('2026-07-20T10:30:00.000Z')}
        onChange={() => {}}
        open={false}
        onOpen={() => {}}
        onClose={() => {}}
      />,
    );
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input?.value).toContain('2026');
  });

  it('does not crash without minDateTime/maxDateTime (both optional)', () => {
    expect(() =>
      renderField(
        <DateRangeField
          label="To:"
          value={new Date('2026-07-27T00:00:00.000Z')}
          onChange={vi.fn()}
          open={false}
          onOpen={() => {}}
          onClose={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  it('accepts min/maxDateTime constraints without crashing', () => {
    expect(() =>
      renderField(
        <DateRangeField
          label="From:"
          value={new Date('2026-07-20T00:00:00.000Z')}
          onChange={vi.fn()}
          open={false}
          onOpen={() => {}}
          onClose={() => {}}
          maxDateTime={new Date('2026-07-27T00:00:00.000Z')}
        />,
      ),
    ).not.toThrow();
  });

  /**
   * Regression coverage for the "Clear button silently no-ops" finding: the
   * old `onChange={(next) => next !== null && onChange(next)}` handler
   * discarded the `null` MUI's action bar sends on Clear, so the button was
   * visible but dead. These two cases pin the fix: the button only appears
   * when a caller opts in via `onClear`, and clicking it calls `onClear`
   * (not `onChange`, which has no way to represent "cleared").
   */
  it('routes a Clear click to onClear, not onChange, when onClear is supplied', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    const { getByRole } = renderField(
      <DateRangeField
        label="From:"
        value={new Date('2026-07-20T00:00:00.000Z')}
        onChange={onChange}
        open
        onOpen={() => {}}
        onClose={() => {}}
        onClear={onClear}
      />,
    );

    await user.click(getByRole('button', { name: /clear/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hides the Clear action entirely when no onClear is supplied', () => {
    const { queryByRole } = renderField(
      <DateRangeField
        label="From:"
        value={new Date('2026-07-20T00:00:00.000Z')}
        onChange={vi.fn()}
        open
        onOpen={() => {}}
        onClose={() => {}}
      />,
    );

    expect(queryByRole('button', { name: /clear/i })).toBeNull();
    // The rest of the action bar (Apply/"OK") is still there — only the
    // dead Clear affordance is removed.
    expect(queryByRole('button', { name: /apply/i })).not.toBeNull();
  });
});
