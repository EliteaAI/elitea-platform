import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ApplicationSaveButton } from './ApplicationSaveButton';

describe('ApplicationSaveButton', () => {
  it('renders the default "Save" label and testid', () => {
    renderWithTheme(<ApplicationSaveButton onSave={vi.fn()} />);
    expect(screen.getByTestId('agent-save-button')).toHaveTextContent('Save');
  });

  it('calls onSave when clicked', () => {
    const onSave = vi.fn();
    renderWithTheme(<ApplicationSaveButton onSave={onSave} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('is disabled when the disabled prop is true', () => {
    renderWithTheme(
      <ApplicationSaveButton
        onSave={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is disabled while isSaving even when disabled is false', () => {
    renderWithTheme(
      <ApplicationSaveButton
        onSave={vi.fn()}
        isSaving
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('accepts a custom label and testid', () => {
    renderWithTheme(
      <ApplicationSaveButton
        onSave={vi.fn()}
        label="Save pipeline"
        testId="pipeline-save-button"
      />,
    );
    expect(screen.getByTestId('pipeline-save-button')).toHaveTextContent('Save pipeline');
  });
});
