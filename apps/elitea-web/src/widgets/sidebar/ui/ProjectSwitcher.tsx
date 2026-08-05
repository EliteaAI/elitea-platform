import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import type { Project } from '@/entities/project';
import { t } from '@/shared/i18n';

import { ProjectAvatar } from './ProjectAvatar';

export interface ProjectSwitcherProps {
  projects: readonly Project[];
  selectedProjectId: string | undefined;
  onSelect: (projectId: string, projectName: string) => void;
  collapsed?: boolean;
}

/**
 * Ported from `[fsd]/widgets/sidebar-root/ui/SidebarProjectSelect.jsx` +
 * `components/ProjectSelect.jsx`, on a hand-rolled dropdown (not
 * `shared/ui`'s `SingleSelect`, whose own doc comment records that avatar/
 * custom-renderer support was explicitly dropped from its S1 scope) so the
 * per-project colour avatar survives the port. Reduced-scope notes (no
 * uploaded project-icon image, no "private project" second pin, no
 * `AlertDialog` confirmation before switching mid-edit) are in
 * `../lib/projectOptions.ts` and `../index.ts`.
 */
export function ProjectSwitcher({ projects, selectedProjectId, onSelect, collapsed = false }: ProjectSwitcherProps): ReactNode {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const selected = projects.find((project) => String(project.id) === selectedProjectId);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const handleSelect = useCallback(
    (project: Project) => {
      onSelect(String(project.id), project.name);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <ClickAwayListener onClickAway={close}>
      <Box sx={{ position: 'relative' }}>
        <Box
          component="button"
          type="button"
          ref={anchorRef}
          onClick={toggle}
          sx={(theme: Theme) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            minHeight: '3.5rem',
            width: '100%',
            border: 'none',
            background: 'transparent',
            textAlign: 'left',
            boxSizing: 'border-box',
            '&:hover': { backgroundColor: theme.vars.palette.background.button.drawerMenu.hover },
          })}
        >
          <ProjectAvatar
            projectName={selected?.name}
            size="1.5rem"
          />
          {!collapsed && (
            <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <Typography
                variant="labelSmall"
                sx={(theme: Theme) => ({ color: theme.vars.palette.text.metrics })}
              >
                {t('widgets.sidebar.projectSwitcher.label', 'Project:')}
              </Typography>
              <Typography
                variant="labelSmall"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '7.5rem',
                }}
              >
                {selected?.name ?? t('widgets.sidebar.projectSwitcher.none', 'No projects')}
              </Typography>
            </Box>
          )}
        </Box>

        <Popper
          open={open && projects.length > 0}
          anchorEl={anchorRef.current}
          placement="bottom-start"
          sx={{ zIndex: 1300 }}
        >
          <Paper
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a real <select>/<datalist> cannot host this custom-styled, avatar-decorated option list; role="listbox" + child role="option" is the standard ARIA pattern for exactly this case.
            role="listbox"
            sx={(theme: Theme) => ({
              background: theme.vars.palette.background.secondary,
              borderRadius: theme.vars.shape.radiusMd,
              border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
              padding: '0.5rem 0',
              minWidth: '14rem',
              maxHeight: '20rem',
              overflowY: 'auto',
              boxShadow: theme.vars.palette.boxShadow.default,
            })}
          >
            {projects.map((project) => (
              <Box
                key={project.id}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- no native tag maps to an ARIA "option" outside a real <select>/<datalist>; this is a custom-styled listbox (role="listbox" on the Paper above), the standard pattern for exactly this case.
                role="option"
                aria-selected={String(project.id) === selectedProjectId}
                tabIndex={0}
                onClick={() => handleSelect(project)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelect(project);
                  }
                }}
                sx={(theme: Theme) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: theme.spacing(1, 2),
                  cursor: 'pointer',
                  '&:hover': { backgroundColor: theme.vars.palette.action.hover },
                })}
              >
                <ProjectAvatar
                  projectName={project.name}
                  size="1.5rem"
                />
                <Typography
                  variant="labelMedium"
                  sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {project.name}
                </Typography>
              </Box>
            ))}
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
