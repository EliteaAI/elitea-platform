import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../__tests__/testUtils';
import { SkillForm } from './SkillForm';

const value = {
  name: 'Reviewer',
  description: 'Reviews code',
  instructions: '# Review\nBe careful.',
  tags: ['quality'],
};

describe('SkillForm', () => {
  it('renders all fields and reports edits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <SkillForm
        value={value}
        onChange={onChange}
      />,
    );
    await user.clear(screen.getByTestId('skill-name-input'));
    await user.type(screen.getByTestId('skill-name-input'), 'New');
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByTestId('skill-tags-input')).toHaveValue('quality');
  });

  it('switches between Markdown edit and preview', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SkillForm
        value={value}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByTestId('skill-instructions-preview')).toHaveTextContent('Review');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('skill-instructions-input')).toBeInTheDocument();
  });

  it('shows validation feedback and keeps icon upload disabled', () => {
    renderWithProviders(
      <SkillForm
        value={{ name: '', description: '', instructions: '', tags: [] }}
        onChange={vi.fn()}
        showErrors
      />,
    );
    expect(screen.getAllByText(/required/i)).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Icon' })).toBeDisabled();
  });

  it('offers AI generation only when the caller supplies it', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const { rerender } = renderWithProviders(
      <SkillForm
        value={value}
        onChange={vi.fn()}
        onGenerate={onGenerate}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Generate with AI' }));
    expect(onGenerate).toHaveBeenCalledOnce();
    rerender(
      <SkillForm
        value={value}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Generate with AI' })).not.toBeInTheDocument();
  });
});
