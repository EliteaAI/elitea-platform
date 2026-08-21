/**
 * The dismiss control of `GeneratedTokenDialog` is an icon-only `IconButton`.
 *
 * It holds a bare "✕" glyph. That glyph gave the button the accessible name
 * "✕", which a screen reader reads as a symbol or skips. The button therefore
 * had no usable name.
 *
 * The fix adds an `aria-label` and hides the glyph with `aria-hidden`. This
 * test pins both: it queries the control by the name "Close", and it checks
 * that the glyph carries aria-hidden.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { GeneratedTokenDialog } from './GeneratedTokenDialog';

describe('GeneratedTokenDialog', () => {
  it('names the dismiss control and hides the glyph from assistive technology', async () => {
    const onClose = vi.fn();
    renderWithTheme(
      <GeneratedTokenDialog
        open
        token="tok-abc"
        name="CI token"
        onClose={onClose}
      />,
    );

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.querySelector('[aria-hidden="true"]')).not.toBeNull();

    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
