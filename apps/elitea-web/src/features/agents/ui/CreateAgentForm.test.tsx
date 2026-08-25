import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../__tests__/testUtils';
import type { AgentDraftValues } from '../model/types';

import { CreateAgentForm } from './CreateAgentForm';

const baseValues: AgentDraftValues = {
  name: 'My Agent',
  description: 'Does things',
  version_details: {
    id: 1,
    instructions: 'Be helpful.',
    welcome_message: 'Hi!',
    variables: [],
    meta: { step_limit: 25 },
  },
};

describe('CreateAgentForm', () => {
  it('renders the name and description fields with their current values', () => {
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('agent-name-input')).toHaveValue('My Agent');
    expect(screen.getByTestId('agent-description-input')).toHaveValue('Does things');
  });

  it('shows no validation error before the name field has been touched', () => {
    renderWithProviders(
      <CreateAgentForm
        values={{ ...baseValues, name: '' }}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
  });

  it('shows a validation error under the name field once blurred empty', () => {
    renderWithProviders(
      <CreateAgentForm
        values={{ ...baseValues, name: '' }}
        onFieldChange={vi.fn()}
      />,
    );
    const nameInput = screen.getByTestId('agent-name-input');
    fireEvent.blur(nameInput);
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the name validation error once the user types a non-blank value', () => {
    const onFieldChange = vi.fn();
    renderWithProviders(
      <CreateAgentForm
        values={{ ...baseValues, name: '' }}
        onFieldChange={onFieldChange}
      />,
    );
    const nameInput = screen.getByTestId('agent-name-input');
    fireEvent.blur(nameInput);
    expect(screen.getByText('Name is required')).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: 'Agent' } });
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
  });

  it('shows a validation error under the description field once blurred empty', () => {
    renderWithProviders(
      <CreateAgentForm
        values={{ ...baseValues, description: '' }}
        onFieldChange={vi.fn()}
      />,
    );
    const descriptionInput = screen.getByTestId('agent-description-input');
    fireEvent.blur(descriptionInput);
    expect(screen.getByText('Description is required')).toBeInTheDocument();
    expect(descriptionInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables the name/description/instructions/welcome-message fields when disabled is true', () => {
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByTestId('agent-name-input')).toBeDisabled();
    expect(screen.getByTestId('agent-description-input')).toBeDisabled();
    expect(screen.getByTestId('agent-welcome-message-input')).toBeDisabled();
  });

  it('calls onFieldChange with the trimmed name on blur', () => {
    const onFieldChange = vi.fn();
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={onFieldChange}
      />,
    );
    const nameInput = screen.getByTestId('agent-name-input');
    fireEvent.change(nameInput, { target: { value: '  Renamed  ' } });
    fireEvent.blur(nameInput);
    expect(onFieldChange).toHaveBeenCalledWith('name', 'Renamed');
  });

  it('calls onFieldChange for the description field on change', () => {
    const onFieldChange = vi.fn();
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={onFieldChange}
      />,
    );
    fireEvent.change(screen.getByTestId('agent-description-input'), { target: { value: 'New description' } });
    expect(onFieldChange).toHaveBeenCalledWith('description', 'New description');
  });

  it('renders the instructions editor when showInstructions is true (default)', () => {
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Be helpful.')).toBeInTheDocument();
  });

  it('does not render the instructions editor when showInstructions is false', () => {
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
        showInstructions={false}
      />,
    );
    expect(screen.queryByText('Be helpful.')).not.toBeInTheDocument();
  });

  it('renders the welcome message input with the current value', () => {
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('agent-welcome-message-input')).toHaveValue('Hi!');
  });

  it('renders the step-limit field from version_details.meta.step_limit', () => {
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('25')).toBeInTheDocument();
  });

  it('renders the generateAgentButtonSlot outside pipeline mode', () => {
    // Non-`<button>` slot content — the accordion summary row this slot
    // renders into is ITSELF a native `<button>` (see this prop's own doc
    // comment on `CreateAgentFormProps`); a nested `<button>` is invalid
    // HTML, confirmed the hard way (React's own console warning) while
    // writing this test.
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
        generateAgentButtonSlot={<span>Generate</span>}
      />,
    );
    expect(screen.getByText('Generate')).toBeInTheDocument();
  });

  it('does not render the generateAgentButtonSlot in pipeline mode', () => {
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
        generateAgentButtonSlot={<span>Generate</span>}
        entityType="pipeline"
      />,
    );
    expect(screen.queryByText('Generate')).not.toBeInTheDocument();
  });

  it('renders the iconSlot/tagsSlot content where supplied', () => {
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
        iconSlot={<div>ICON</div>}
        tagsSlot={<div>TAGS</div>}
      />,
    );
    expect(screen.getByText('ICON')).toBeVisible();
    expect(screen.getByText('TAGS')).toBeVisible();
  });

  // #307 — the conversation-starters editor is rendered by this component
  // itself now (it was a slot every caller left empty). Asserted through the
  // callback, not by the section merely existing: an editor that renders and
  // routes nothing is the exact defect this closes.
  it('renders the conversation-starters editor and routes an edit to version_details.conversation_starters', async () => {
    const user = userEvent.setup();
    const onFieldChange = vi.fn();
    renderWithProviders(
      <CreateAgentForm
        values={{
          ...baseValues,
          version_details: { ...baseValues.version_details, conversation_starters: ['first'] },
        }}
        onFieldChange={onFieldChange}
      />,
    );

    const input = screen.getByTestId('agent-conversation-starter-input');
    expect(input).toBeVisible();
    expect(input).toHaveValue('first');

    await user.type(input, '!');
    expect(onFieldChange).toHaveBeenCalledWith('version_details.conversation_starters', ['first!']);
  });

  it('does not render ApplicationVariables when there are no variables', () => {
    renderWithProviders(
      <CreateAgentForm
        values={baseValues}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Variables')).not.toBeInTheDocument();
  });

  it('renders ApplicationVariables and forwards edits when variables are present', () => {
    const onFieldChange = vi.fn();
    renderWithProviders(
      <CreateAgentForm
        values={{
          ...baseValues,
          version_details: { ...baseValues.version_details, variables: [{ name: 'topic', value: 'weather' }] },
        }}
        onFieldChange={onFieldChange}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('weather'), { target: { value: 'sports' } });
    expect(onFieldChange).toHaveBeenCalledWith('version_details.variables', [{ name: 'topic', value: 'sports' }]);
  });
});
