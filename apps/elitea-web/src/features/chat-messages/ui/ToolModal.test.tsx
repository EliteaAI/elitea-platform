/**
 * The dismiss control of `ToolModal` is an icon-only `IconButton`.
 *
 * `CloseIcon` renders an `<svg>` with no text, so the button had an empty
 * accessible name. A screen reader announced it as a bare "button". The user
 * could not tell the dismiss control from any other control in the modal.
 *
 * This test names the control by its accessible name. It fails if the
 * `aria-label` goes away again.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ToolModal } from './ToolModal';

describe('ToolModal', () => {
  it('names the dismiss control and closes on click', async () => {
    const onClose = vi.fn();
    renderWithTheme(
      <ToolModal
        open
        onClose={onClose}
        toolAction={{ name: 'search_docs' }}
      />,
    );

    expect(screen.getAllByRole('heading', { name: 'search_docs' }).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
