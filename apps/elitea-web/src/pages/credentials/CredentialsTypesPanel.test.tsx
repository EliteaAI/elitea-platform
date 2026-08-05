import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialsTypesPanel } from './CredentialsTypesPanel';
import type { CredentialTypeTag } from './CredentialsTypesPanel';

const TAGS: CredentialTypeTag[] = [
  { id: 'openai1', name: 'Openai', data: { type: 'openai' }, credentialCount: 2 },
  { id: 'azure2', name: 'Azure', data: { type: 'azure' }, credentialCount: 1 },
];

describe('CredentialsTypesPanel', () => {
  it('renders one chip per tag with its count', () => {
    renderWithTheme(
      <CredentialsTypesPanel
        tagList={TAGS}
        selectedTypes={[]}
        onToggleType={vi.fn()}
      />,
    );
    expect(screen.getByText('Openai (2)')).toBeInTheDocument();
    expect(screen.getByText('Azure (1)')).toBeInTheDocument();
  });

  it('calls onToggleType with the underlying type, not the display name', () => {
    const onToggleType = vi.fn();
    renderWithTheme(
      <CredentialsTypesPanel
        tagList={TAGS}
        selectedTypes={[]}
        onToggleType={onToggleType}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Openai' }));
    expect(onToggleType).toHaveBeenCalledWith('openai');
  });

  it('marks the chip pressed when its type is selected', () => {
    renderWithTheme(
      <CredentialsTypesPanel
        tagList={TAGS}
        selectedTypes={['azure']}
        onToggleType={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Azure' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Openai' })).toHaveAttribute('aria-pressed', 'false');
  });
});
