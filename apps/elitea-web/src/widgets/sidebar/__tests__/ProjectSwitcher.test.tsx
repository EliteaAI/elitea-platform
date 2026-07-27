import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
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
    expect(screen.getByRole('option', { name: /Public/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Acme/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Acme/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Public/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('does not open the dropdown when there are no projects to choose from', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <ProjectSwitcher
        projects={[]}
        selectedProjectId={undefined}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('option', { name: /Public/ }));
    expect(onSelect).toHaveBeenCalledWith('11', 'Public');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
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
