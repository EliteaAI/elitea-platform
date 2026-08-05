import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../__tests__/testUtils';

import { AgentInternalToolSwitch } from './AgentInternalToolSwitch';

describe('AgentInternalToolSwitch', () => {
  it('renders the title and the resolved icon', () => {
    renderWithProviders(
      <AgentInternalToolSwitch
        title="Python sandbox"
        icon="PythonIcon"
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Python sandbox')).toBeInTheDocument();
  });

  it('renders without crashing for an unknown icon key', () => {
    renderWithProviders(
      <AgentInternalToolSwitch
        title="Mystery tool"
        icon="NotARealIcon"
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Mystery tool')).toBeInTheDocument();
  });

  it('reflects the checked prop', () => {
    renderWithProviders(
      <AgentInternalToolSwitch
        title="Python sandbox"
        icon="PythonIcon"
        checked
        onCheckedChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('calls onCheckedChange with the new value when toggled', () => {
    const onCheckedChange = vi.fn();
    renderWithProviders(
      <AgentInternalToolSwitch
        title="Python sandbox"
        icon="PythonIcon"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('disables the switch when disabled is true', () => {
    renderWithProviders(
      <AgentInternalToolSwitch
        title="Python sandbox"
        icon="PythonIcon"
        checked={false}
        onCheckedChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('renders an info tooltip when infoTooltip.text is supplied', () => {
    renderWithProviders(
      <AgentInternalToolSwitch
        title="Python sandbox"
        icon="PythonIcon"
        checked={false}
        onCheckedChange={vi.fn()}
        infoTooltip={{ text: 'Runs code in a sandbox' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Runs code in a sandbox' })).toBeInTheDocument();
  });
});
