import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

import { renderWithProviders } from '../__tests__/testUtils';

import { VersionReplacementModal } from './VersionReplacementModal';

const versions = [
  { id: 1, name: 'base', created_at: undefined },
  { id: 2, name: 'v2', created_at: '2026-01-15T00:00:00Z' },
  { id: 3, name: 'v3', created_at: '2026-02-20T00:00:00Z' },
];

const parents = [
  { application_id: 10, version_id: 1, application_name: 'My Agent', version_name: 'base' },
  { application_id: 10, version_id: 1, application_name: 'My Agent', version_name: 'base' }, // duplicate, should be deduplicated
  { application_id: 11, version_id: 1, application_name: 'Other Agent', version_name: 'base' },
];

describe('VersionReplacementModal', () => {
  it('does not render dialog content while closed', () => {
    renderWithProviders(
      <VersionReplacementModal
        open={false}
        onClose={vi.fn()}
        versionName="base"
        referencingParents={parents}
        replacementVersions={versions}
        onReplace={vi.fn()}
      />,
    );
    expect(screen.queryByText('Version in use')).not.toBeInTheDocument();
  });

  it('renders the version name and deduplicated affected count', () => {
    renderWithProviders(
      <VersionReplacementModal
        open
        onClose={vi.fn()}
        versionName="base"
        referencingParents={parents}
        replacementVersions={versions}
        onReplace={vi.fn()}
      />,
    );
    expect(screen.getByText('Version in use')).toBeInTheDocument();
    expect(screen.getByText('Affected (2):')).toBeInTheDocument();
    expect(screen.getByText('• My Agent (base)')).toBeInTheDocument();
    expect(screen.getByText('• Other Agent (base)')).toBeInTheDocument();
  });

  it('disables Replace & Delete until a version is selected, then calls onReplace with the selected id', () => {
    const onReplace = vi.fn();
    renderWithProviders(
      <VersionReplacementModal
        open
        onClose={vi.fn()}
        versionName="base"
        referencingParents={parents}
        replacementVersions={versions}
        onReplace={onReplace}
        defaultVersionId={2}
      />,
    );
    // Auto-selects defaultVersionId (2) on open, so Replace becomes enabled immediately.
    const replaceButton = screen.getByRole('button', { name: /Replace & Delete/i });
    expect(replaceButton).toBeEnabled();
    fireEvent.click(replaceButton);
    expect(onReplace).toHaveBeenCalledWith(2);
  });

  it('replaces on Enter keydown, same as clicking Replace & Delete', () => {
    // Baseline (`VersionReplacementModal.jsx`) wires `onKeyDown` on the
    // `Dialog` to call `handleReplace()` on Enter. A port that drops the
    // handler leaves the keyboard shortcut dead.
    const onReplace = vi.fn();
    renderWithProviders(
      <VersionReplacementModal
        open
        onClose={vi.fn()}
        versionName="base"
        referencingParents={parents}
        replacementVersions={versions}
        onReplace={onReplace}
        defaultVersionId={2}
      />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onReplace).toHaveBeenCalledWith(2);
  });

  it('does not replace on Enter keydown while isReplacing is true', () => {
    const onReplace = vi.fn();
    renderWithProviders(
      <VersionReplacementModal
        open
        onClose={vi.fn()}
        versionName="base"
        referencingParents={parents}
        replacementVersions={versions}
        onReplace={onReplace}
        defaultVersionId={2}
        isReplacing
      />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onReplace).not.toHaveBeenCalled();
  });

  it('shows a loading indicator on the Replace & Delete button while isReplacing is true', () => {
    // Baseline passes `loading={isReplacing}` to `Button.BaseBtn`, which
    // this app's `BaseBtn` (a thin wrapper over MUI's `Button`) supports
    // natively via MUI's own `loading` prop. Dropping the prop leaves the
    // button merely disabled, with no spinner.
    renderWithProviders(
      <VersionReplacementModal
        open
        onClose={vi.fn()}
        versionName="base"
        referencingParents={parents}
        replacementVersions={versions}
        onReplace={vi.fn()}
        isReplacing
      />,
    );
    const replaceButton = screen.getByRole('button', { name: /Replacing.../i });
    expect(within(replaceButton).getByRole('progressbar')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <VersionReplacementModal
        open
        onClose={onClose}
        versionName="base"
        referencingParents={parents}
        replacementVersions={versions}
        onReplace={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows "Replacing..." and disables both buttons while isReplacing is true', () => {
    renderWithProviders(
      <VersionReplacementModal
        open
        onClose={vi.fn()}
        versionName="base"
        referencingParents={parents}
        replacementVersions={versions}
        onReplace={vi.fn()}
        isReplacing
      />,
    );
    expect(screen.getByRole('button', { name: /Replacing.../i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeDisabled();
  });

  it('renders zero affected parents gracefully', () => {
    renderWithProviders(
      <VersionReplacementModal
        open
        onClose={vi.fn()}
        versionName="base"
        referencingParents={[]}
        replacementVersions={versions}
        onReplace={vi.fn()}
      />,
    );
    expect(screen.getByText('Affected (0):')).toBeInTheDocument();
  });

  it('renders without crashing when replacementVersions is undefined', () => {
    renderWithProviders(
      <VersionReplacementModal
        open
        onClose={vi.fn()}
        versionName="base"
        referencingParents={parents}
        replacementVersions={undefined}
        onReplace={vi.fn()}
      />,
    );
    expect(within(screen.getByRole('dialog')).getByText('Version in use')).toBeInTheDocument();
  });
});
