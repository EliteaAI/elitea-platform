import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../__tests__/testUtils';
import { SkillImportButton } from './SkillImportButton';

describe('SkillImportButton', () => {
  it('rejects files that are not Markdown', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(
      <SkillImportButton
        isImporting={false}
        onImport={vi.fn()}
      />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'skill.txt', { type: 'text/plain' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Only .md');
  });

  it('stages valid frontmatter and imports after confirmation', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SkillImportButton
        isImporting={false}
        onImport={onImport}
      />,
    );
    const file = new File(['x'], 'skill.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve('---\nname: Reviewer\ndescription: Review code\n---\nBe careful'),
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(await screen.findByText('Reviewer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(file));
  });
});
