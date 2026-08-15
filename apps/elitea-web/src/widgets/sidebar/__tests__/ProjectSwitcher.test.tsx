import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Project } from '@/entities/project';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ProjectSwitcher } from '../ui/ProjectSwitcher';

const projects: readonly Project[] = [
  { id: 11, name: 'Public', status: 'active', suspended: false },
  { id: 2, name: 'Acme', status: 'active', suspended: false },
];

describe('ProjectSwitcher', () => {
  it('shows "No projects" when the list is empty', () => {
    renderWithTheme(
      <ProjectSwitcher
        projects={[]}
        selectedProjectId={undefined}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('No projects')).toBeInTheDocument();
  });

  it('shows the selected project name', () => {
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('collapsed mode hides the text block', () => {
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
        collapsed
      />,
    );
    expect(screen.queryByText('Project:')).not.toBeInTheDocument();
  });

  /** R4 regression: `customRenderProject`'s `StyledTooltip` (`SidebarProjectSelect.jsx:25-63`). */
  it('R4: collapsed mode shows the selected project name in a hover tooltip', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
        collapsed
      />,
    );
    await user.hover(screen.getByRole('button'));
    const tooltip = await screen.findByRole('tooltip', undefined, { timeout: 2000 });
    expect(tooltip).toHaveTextContent('Acme');
  });

  it('R4: collapsed mode falls back to "No projects" in the tooltip when the list is empty', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <ProjectSwitcher
        projects={[]}
        selectedProjectId={undefined}
        onSelect={vi.fn()}
        collapsed
      />,
    );
    await user.hover(screen.getByRole('button'));
    const tooltip = await screen.findByRole('tooltip', undefined, { timeout: 2000 });
    expect(tooltip).toHaveTextContent('No projects');
  });

  it('R4: expanded mode shows no tooltip (title is already visible inline)', () => {
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  /**
   * Issue #238 regression: the trigger must announce itself as a dropdown.
   * The pre-fix component carried neither attribute, so both halves of this
   * assertion failed against it.
   */
  it('issue 238: the trigger announces a listbox popup and reports the closed state', () => {
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  it('issue 238: clicking the trigger flips aria-expanded to true and points aria-controls at the listbox', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    expect(trigger).toHaveAttribute('aria-controls', listbox.id);
    expect(listbox.id).not.toBe('');
  });

  it('issue 238: clicking the trigger a second time closes the popup and resets aria-expanded', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button');
    await user.click(trigger);
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  /** Issue #238: without a visible arrow the control reads as static text. */
  it('issue 238: expanded mode draws the dropdown chevron', () => {
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('project-switcher-chevron')).toBeInTheDocument();
  });

  it('issue 238: the chevron rotates to indicate the open state', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('project-switcher-chevron')).toHaveStyle({ transform: 'rotate(0deg)' });
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('project-switcher-chevron')).toHaveStyle({ transform: 'rotate(180deg)' });
  });

  it('issue 238: collapsed mode hides the chevron, leaving only the avatar', () => {
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
        collapsed
      />,
    );
    expect(screen.queryByTestId('project-switcher-chevron')).not.toBeInTheDocument();
  });

  it('opens the dropdown on click and lists every project', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    // Each row is avatar-initial + name, so match on containment, not equality.
    const names = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(names).toHaveLength(projects.length);
    expect(names[0]).toContain('Public');
    expect(names[1]).toContain('Acme');
    expect(screen.getByRole('option', { name: /Acme/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Public/ })).toHaveAttribute('aria-selected', 'false');
  });

  /**
   * Issue #238: the popup used to be gated on `open && projects.length > 0`,
   * so an empty list turned the trigger into a silent no-op. It now opens on
   * a disabled "No projects" row, the same copy the trigger text falls back to.
   */
  it('issue 238: an empty project list opens a disabled "No projects" row, not nothing', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <ProjectSwitcher
        projects={[]}
        selectedProjectId={undefined}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const empty = screen.getByRole('option', { name: 'No projects' });
    expect(empty).toHaveAttribute('aria-disabled', 'true');
    expect(empty).toHaveAttribute('aria-selected', 'false');
  });

  it('issue 238: the empty "No projects" row does not select anything when clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithTheme(
      <ProjectSwitcher
        projects={[]}
        selectedProjectId={undefined}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('option', { name: 'No projects' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selecting an option calls onSelect and closes the dropdown', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={onSelect}
      />,
    );
    const trigger = screen.getByRole('button');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: /Public/ }));
    expect(onSelect).toHaveBeenCalledWith('11', 'Public');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('selecting an option via the keyboard (Enter) also calls onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithTheme(
      <ProjectSwitcher
        projects={projects}
        selectedProjectId="2"
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole('button'));
    screen.getByRole('option', { name: /Public/ }).focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('11', 'Public');
  });

  it('clicking away closes the dropdown without selecting', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithTheme(
      <div>
        <ProjectSwitcher
          projects={projects}
          selectedProjectId="2"
          onSelect={onSelect}
        />
        <button type="button">outside</button>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: /Acme/ }));
    expect(screen.getByRole('option', { name: /Public/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
