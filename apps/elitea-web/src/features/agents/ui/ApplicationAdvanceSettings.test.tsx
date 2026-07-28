import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../__tests__/testUtils';

import { ApplicationAdvanceSettings } from './ApplicationAdvanceSettings';

describe('ApplicationAdvanceSettings', () => {
  it('renders the current step limit', () => {
    renderWithProviders(
      <ApplicationAdvanceSettings
        stepLimit={25}
        onStepLimitChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('25')).toBeInTheDocument();
  });

  it('clamps a step limit above MAX_STEP_LIMIT (999)', () => {
    const onStepLimitChange = vi.fn();
    renderWithProviders(
      <ApplicationAdvanceSettings
        stepLimit={0}
        onStepLimitChange={onStepLimitChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Step limit/i), { target: { value: '5000' } });
    expect(onStepLimitChange).toHaveBeenCalledWith(999);
  });

  it('reports undefined for a cleared field', () => {
    const onStepLimitChange = vi.fn();
    renderWithProviders(
      <ApplicationAdvanceSettings
        stepLimit={10}
        onStepLimitChange={onStepLimitChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Step limit/i), { target: { value: '' } });
    expect(onStepLimitChange).toHaveBeenCalledWith(undefined);
  });

  it('does not render the ignore-project-context toggle unless showIgnoreProjectContext is set', () => {
    renderWithProviders(
      <ApplicationAdvanceSettings
        stepLimit={10}
        onStepLimitChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Ignore Project Context/i)).not.toBeInTheDocument();
  });

  it('toggles ignoreProjectContext via the checkbox when shown', () => {
    const onIgnoreProjectContextChange = vi.fn();
    renderWithProviders(
      <ApplicationAdvanceSettings
        stepLimit={10}
        onStepLimitChange={vi.fn()}
        showIgnoreProjectContext
        ignoreProjectContext={false}
        onIgnoreProjectContextChange={onIgnoreProjectContextChange}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onIgnoreProjectContextChange).toHaveBeenCalledWith(true);
  });
});
