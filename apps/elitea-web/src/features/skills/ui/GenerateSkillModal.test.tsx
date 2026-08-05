import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../__tests__/testUtils';
import { GenerateSkillModal } from './GenerateSkillModal';

describe('GenerateSkillModal', () => {
  it('requires a description before generation', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GenerateSkillModal
        open
        isGenerating={false}
        onClose={vi.fn()}
        onGenerate={vi.fn()}
        onApprove={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Describe');
  });

  it('generates, reviews, and approves a valid draft', async () => {
    const user = userEvent.setup();
    const draft = { name: 'Reviewer', description: 'Review', instructions: 'Be careful', tags: [] };
    const onGenerate = vi.fn().mockResolvedValue(draft);
    const onApprove = vi.fn();
    renderWithProviders(
      <GenerateSkillModal
        open
        isGenerating={false}
        onClose={vi.fn()}
        onGenerate={onGenerate}
        onApprove={onApprove}
      />,
    );
    await user.type(screen.getByLabelText('What should this skill do?'), 'Review code');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(screen.getByTestId('skill-name-input')).toHaveValue('Reviewer'));
    await user.click(screen.getByRole('button', { name: 'Use draft' }));
    expect(onApprove).toHaveBeenCalledWith(draft);
  });

  it('shows a safe error when generation rejects and resets after close', async () => {
    const user = userEvent.setup();
    const props = {
      open: true,
      isGenerating: false,
      onClose: vi.fn(),
      onGenerate: vi.fn().mockRejectedValue(new Error('internal')),
      onApprove: vi.fn(),
    };
    const { rerender } = renderWithProviders(<GenerateSkillModal {...props} />);
    await user.type(screen.getByLabelText('What should this skill do?'), 'Review code');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to generate');
    rerender(
      <GenerateSkillModal
        {...props}
        open={false}
      />,
    );
    rerender(<GenerateSkillModal {...props} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
