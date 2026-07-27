import type { ReactElement } from 'react';

import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import type { RenderResult } from '@testing-library/react';
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
});
