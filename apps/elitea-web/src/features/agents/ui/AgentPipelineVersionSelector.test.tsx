import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { AgentPipelineVersionOption } from '../lib/types';

import { AgentPipelineVersionSelector } from './AgentPipelineVersionSelector';

// Noon UTC so a local-timezone test runner never crosses a day boundary and
// renders a different calendar date than the UTC one written here.
const versions: readonly AgentPipelineVersionOption[] = [
  { id: 1, name: 'base', created_at: '2026-01-01T12:00:00Z' },
  { id: 2, name: 'v1', created_at: '2026-02-01T12:00:00Z' },
  { id: 3, name: 'v0', created_at: '2026-01-15T12:00:00Z' },
];

/** Mirrors `formatVersionDisplayText`'s date formatting exactly, so assertions aren't hard-coded against one timezone. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

describe('AgentPipelineVersionSelector', () => {
  it('shows the latest ("base") version label when the selected version is the latest', () => {
    const { getByText } = renderWithTheme(
      <AgentPipelineVersionSelector
        applicationVersionId={1}
        versions={versions}
        onSelectVersion={vi.fn()}
      />,
    );
    expect(getByText('base')).toBeInTheDocument();
  });

  it('shows the formatted name + date for a non-latest selected version', () => {
    const { getByText } = renderWithTheme(
      <AgentPipelineVersionSelector
        applicationVersionId={2}
        versions={versions}
        onSelectVersion={vi.fn()}
      />,
    );
    expect(getByText(`v1 – ${formatDate('2026-02-01T12:00:00Z')}`)).toBeInTheDocument();
  });

  it('shows "Invalid version" and a warning icon when applicationVersionId does not match any version', () => {
    const { getByText, container } = renderWithTheme(
      <AgentPipelineVersionSelector
        applicationVersionId={999}
        versions={versions}
        onSelectVersion={vi.fn()}
      />,
    );
    expect(getByText('Invalid version')).toBeInTheDocument();
    expect(container.querySelector('svg[data-testid="WarningAmberIcon"]')).toBeInTheDocument();
  });

  it('falls back to the latest version display when applicationVersionId is undefined', () => {
    const { getByText } = renderWithTheme(
      <AgentPipelineVersionSelector
        applicationVersionId={undefined}
        versions={versions}
        onSelectVersion={vi.fn()}
      />,
    );
    expect(getByText('base')).toBeInTheDocument();
  });

  it('opens the menu, lists versions with the latest first then newest-first by date, and calls onSelectVersion on click', async () => {
    const user = userEvent.setup();
    const onSelectVersion = vi.fn();
    const { getByTestId, getAllByRole, getByText } = renderWithTheme(
      <AgentPipelineVersionSelector
        applicationVersionId={1}
        versions={versions}
        onSelectVersion={onSelectVersion}
      />,
    );
    await user.click(getByTestId('version-selector-trigger'));

    const items = getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual(['base', `v1 – ${formatDate('2026-02-01T12:00:00Z')}`, `v0 – ${formatDate('2026-01-15T12:00:00Z')}`]);

    await user.click(getByText(`v1 – ${formatDate('2026-02-01T12:00:00Z')}`));
    expect(onSelectVersion).toHaveBeenCalledWith(expect.objectContaining({ id: 2, name: 'v1' }));
  });

  it('does not open the dropdown when disabled', async () => {
    const user = userEvent.setup();
    const { getByTestId, queryByRole } = renderWithTheme(
      <AgentPipelineVersionSelector
        applicationVersionId={1}
        versions={versions}
        disabled
        onSelectVersion={vi.fn()}
      />,
    );
    await user.click(getByTestId('version-selector-trigger'));
    expect(queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows a switching spinner and makes the trigger inert while a version switch is in flight', async () => {
    const user = userEvent.setup();
    const { getByTestId, queryByRole } = renderWithTheme(
      <AgentPipelineVersionSelector
        applicationVersionId={1}
        versions={versions}
        isSwitchingVersion
        onSelectVersion={vi.fn()}
      />,
    );
    expect(getByTestId('version-selector-switching')).toBeInTheDocument();

    await user.click(getByTestId('version-selector-trigger'));
    expect(queryByRole('menu')).not.toBeInTheDocument();
  });

  it('gives the version list its own scrollable region so overflowing versions stay reachable', async () => {
    const user = userEvent.setup();
    const manyVersions: readonly AgentPipelineVersionOption[] = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      name: `v${i}`,
      created_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`,
    }));
    const { getByTestId, getByRole } = renderWithTheme(
      <AgentPipelineVersionSelector
        applicationVersionId={1}
        versions={manyVersions}
        onSelectVersion={vi.fn()}
      />,
    );
    await user.click(getByTestId('version-selector-trigger'));

    // The menu's own list (not just its Paper) needs a bounded, scrollable
    // region — otherwise versions beyond the Paper's maxHeight are clipped
    // by the Paper's `overflow: hidden` with no way to reach them.
    const menu = getByRole('menu');
    const computed = getComputedStyle(menu);
    expect(computed.overflowY).toBe('auto');
    expect(computed.maxHeight).toBe('11.5rem');
  });

  it('calls onRefreshVersions from the menu refresh button', async () => {
    const user = userEvent.setup();
    const onRefreshVersions = vi.fn();
    const { getByTestId, getByRole } = renderWithTheme(
      <AgentPipelineVersionSelector
        applicationVersionId={1}
        versions={versions}
        onSelectVersion={vi.fn()}
        onRefreshVersions={onRefreshVersions}
      />,
    );
    await user.click(getByTestId('version-selector-trigger'));
    await user.click(getByRole('button', { name: 'Refresh versions' }));
    expect(onRefreshVersions).toHaveBeenCalledTimes(1);
  });
});
