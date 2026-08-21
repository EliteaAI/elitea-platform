/**
 * The clear control of `MaxTokensSection` is an icon-only `IconButton`.
 *
 * `ClearIcon` renders an `<svg>` with no text, so the button had an empty
 * accessible name. It sits inside the max-tokens field adornment. A screen
 * reader announced a bare "button" next to the value. The announcement gave
 * no clue about the action.
 *
 * This test queries the control by its accessible name. It fails if the
 * `aria-label` goes away again.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DEFAULT_MAX_TOKENS } from '@/shared/lib/constants';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { MaxTokensSection } from './MaxTokensSection';

describe('MaxTokensSection', () => {
  it('names the clear control and resets the value to the default', async () => {
    const onChange = vi.fn();
    renderWithTheme(
      <MaxTokensSection
        value={2048}
        onChange={onChange}
        onBlur={vi.fn()}
        onFocus={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Clear the max tokens value' }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_MAX_TOKENS);
  });

  it('renders no clear control while the mode is auto', () => {
    renderWithTheme(
      <MaxTokensSection
        value={DEFAULT_MAX_TOKENS}
        onChange={vi.fn()}
        onBlur={vi.fn()}
        onFocus={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Clear the max tokens value' }),
    ).not.toBeInTheDocument();
  });
});
