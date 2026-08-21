/**
 * The dismiss control of `CodePreviewHeader` is an icon-only `IconButton`.
 *
 * `CloseIcon` renders an `<svg>` with no text, so the button had an empty
 * accessible name. The header also holds two select controls, so a screen
 * reader announced a third, unnamed "button" beside them.
 *
 * This test queries the control by its accessible name. It fails if the
 * `aria-label` goes away again.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import CodePreviewHeader from './CodePreviewHeader';

describe('CodePreviewHeader', () => {
  it('names the close button and calls onClose when it is clicked', async () => {
    const onClose = vi.fn();
    renderWithTheme(
      <CodePreviewHeader
        selectedLanguage="python"
        onLanguageChange={vi.fn()}
        models={[]}
        selectedModel={null}
        onClose={onClose}
        showCloseButton
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders no close button while showCloseButton is false', () => {
    renderWithTheme(
      <CodePreviewHeader
        selectedLanguage="python"
        onLanguageChange={vi.fn()}
        models={[]}
        selectedModel={null}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });
});
