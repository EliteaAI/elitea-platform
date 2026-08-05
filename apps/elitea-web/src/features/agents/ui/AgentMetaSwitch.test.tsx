import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../__tests__/testUtils';

import { AgentMetaSwitch } from './AgentMetaSwitch';

describe('AgentMetaSwitch', () => {
  it('renders the title and reflects the checked state', () => {
    renderWithProviders(
      <AgentMetaSwitch
        title="Enable memory"
        checked
        onCheckedChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Enable memory')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('calls onCheckedChange with the new value when toggled', () => {
    const onCheckedChange = vi.fn();
    renderWithProviders(
      <AgentMetaSwitch
        title="Enable memory"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('disables the switch when disabled is true', () => {
    renderWithProviders(
      <AgentMetaSwitch
        title="Enable memory"
        checked={false}
        onCheckedChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('renders an info tooltip trigger when infoTooltip is supplied', () => {
    renderWithProviders(
      <AgentMetaSwitch
        title="Enable memory"
        checked={false}
        onCheckedChange={vi.fn()}
        infoTooltip={{ text: 'Explains the feature' }}
      />,
    );
    // `InfoTooltip`'s accessible name is the tooltip's own string title.
    expect(screen.getByRole('button', { name: 'Explains the feature' })).toBeInTheDocument();
  });
});
