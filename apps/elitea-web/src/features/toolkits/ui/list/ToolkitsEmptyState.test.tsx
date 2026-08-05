import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../__tests__/testUtils';
import { ToolkitsEmptyState } from './ToolkitsEmptyState';

describe('ToolkitsEmptyState', () => {
  it('renders title, description, and a Create button', () => {
    renderWithProviders(
      <ToolkitsEmptyState
        title="No toolkits yet"
        description="Create your first toolkit."
        onCreateClick={vi.fn()}
      />,
    );
    expect(screen.getByText('No toolkits yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first toolkit.')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('calls onCreateClick when the Create button is clicked', () => {
    const onCreateClick = vi.fn();
    renderWithProviders(
      <ToolkitsEmptyState
        title="No toolkits yet"
        description="Create your first toolkit."
        onCreateClick={onCreateClick}
      />,
    );
    fireEvent.click(screen.getByText('Create'));
    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });

  it('does not render a guided-tour button when onGuidedTourClick is omitted', () => {
    renderWithProviders(
      <ToolkitsEmptyState
        title="No toolkits yet"
        description="Create your first toolkit."
        onCreateClick={vi.fn()}
      />,
    );
    expect(screen.queryByText('Start Guided Tour')).not.toBeInTheDocument();
  });

  it('renders and wires the guided-tour button when supplied', () => {
    const onGuidedTourClick = vi.fn();
    renderWithProviders(
      <ToolkitsEmptyState
        title="No toolkits yet"
        description="Create your first toolkit."
        onCreateClick={vi.fn()}
        onGuidedTourClick={onGuidedTourClick}
      />,
    );
    fireEvent.click(screen.getByText('Start Guided Tour'));
    expect(onGuidedTourClick).toHaveBeenCalledTimes(1);
  });
});
