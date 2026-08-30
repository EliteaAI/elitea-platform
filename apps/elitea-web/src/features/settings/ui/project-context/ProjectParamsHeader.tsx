/**
 * ProjectParamsHeader — header bar showing project name, icon, and teammate
 * count, with an edit-icon button that opens the icon selector.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/ProjectParamsHeader.jsx`.
 *
 * Deviations from the baseline:
 *  - Accepts `onIconChange` callback so parent can persist icon via
 *    `updateProjectInfo` mutation (Task 3 fix)
 */
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import { useCallback, useState } from 'react';

import EditIcon from '@mui/icons-material/Edit';

import { useProjectInfoQuery } from '@/entities/project';
import { t } from '@/shared/i18n';

import { ProjectIconDialog, type SelectedProjectIcon } from './ProjectIconDialog';

export interface ProjectParamsHeaderProps {
  projectId: string;
  projectName: string;
  /** Whether the user has edit permission — gates the icon-edit affordance. */
  canEdit: boolean;
  /**
   * Called when the user selects an icon — parent persists via
   * updateProjectInfo. Carries the whole icon, not just its name: see
   * SelectedProjectIcon.
   */
  onIconChange?: (icon: SelectedProjectIcon | null) => void;
}

export function ProjectParamsHeader({
  projectId,
  projectName,
  canEdit,
  onIconChange,
}: ProjectParamsHeaderProps) {
  const [iconDialogOpen, setIconDialogOpen] = useState(false);
  const { data: projectInfo } = useProjectInfoQuery(projectId, {
    enabled: !!projectId,
  });

  const iconMeta = projectInfo?.icon_meta;

  /**
   * `teammatesCount` is `null`, not `0`, when the server did not give a count.
   *
   * The old `?? 0` turned an absent key into a rendered figure: on a
   * deployment without the project-info capability, the endpoint answered 200
   * and simply omitted `teammates_count`, and every project displayed
   * "Teammates: 0" — a number nobody had counted. That endpoint now refuses
   * (501, `project_info_not_available`) rather than answering with a shape it
   * has not measured, and the row below renders an em dash instead of
   * repeating the same claim on the client.
   *
   * 501 is classified as final by the query client, so this state is reached
   * with ONE request and no retry loop.
   */
  const teammatesCount = projectInfo?.teammates_count ?? null;
  const sx = styles();

  const handleOpenIconDialog = useCallback(() => {
    if (!canEdit) return;
    setIconDialogOpen(true);
  }, [canEdit]);

  const handleCloseIconDialog = useCallback(() => {
    setIconDialogOpen(false);
  }, []);

  const handleIconSelect = useCallback(
    (icon: SelectedProjectIcon | null) => {
      onIconChange?.(icon);
      handleCloseIconDialog();
    },
    [onIconChange, handleCloseIconDialog],
  );

  return (
    <Box sx={sx.root}>
      <Box sx={sx.headerContent}>
        <Box sx={sx.avatarWrapper}>
          <ProjectAvatar
            projectName={projectName}
            iconUrl={iconMeta?.url ?? null}
          />
          {canEdit && (
            <IconButton
              sx={sx.editButton}
              aria-label={t('entities.projectContext.header.editIconAriaLabel', 'Edit the project icon')}
              onClick={handleOpenIconDialog}
            >
              <EditIcon sx={sx.editIcon} />
            </IconButton>
          )}
        </Box>

        <Box sx={sx.infoContainer}>
          <Typography
            variant="headingSmall"
            color="text.secondary"
            sx={sx.projectName}
          >
            {projectName}
          </Typography>
          <Box sx={sx.metaRow}>
            <Box sx={sx.metaItem}>
              <Typography
                variant="bodySmall"
                sx={sx.metaLabel}
              >
                {t('entities.projectContext.projectParamsHeader.teammates', 'Teammates:')}
              </Typography>
              <Typography
                variant="bodySmall"
                sx={sx.metaValue}
                title={
                  teammatesCount === null
                    ? t(
                        'entities.projectContext.projectParamsHeader.teammatesUnavailable',
                        'This deployment does not report a teammate count.',
                      )
                    : undefined
                }
              >
                {teammatesCount ?? '—'}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>

      {iconDialogOpen && (
        <ProjectIconDialog
          open={iconDialogOpen}
          onClose={handleCloseIconDialog}
          onIconSelect={handleIconSelect}
          projectId={projectId}
          selectedIcon={iconMeta ?? null}
          projectName={projectName}
        />
      )}
    </Box>
  );
}

function ProjectAvatar({
  projectName,
  iconUrl,
}: {
  projectName: string;
  iconUrl: string | null;
}) {
  const theme = useTheme();
  const avatarSx: SxProps<Theme> = {
    width: '3.5rem',
    height: '3.5rem',
    borderRadius: 'var(--el-shape-radiusPill, 9999px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: theme.typography.headingSmall.fontSize,
    fontWeight: 600,
    color: 'text.primary',
    backgroundColor: 'action.selected',
  };
  if (iconUrl) {
    return (
      <Box
        component="img"
        src={iconUrl}
        alt={projectName}
        sx={avatarSx}
      />
    );
  }
  const initial = projectName ? projectName.charAt(0).toUpperCase() : '?';
  return (
    <Box sx={avatarSx}>
      {initial}
    </Box>
  );
}

const styles = (): Record<string, SxProps<Theme>> => ({
  root: {
    padding: '1.5rem',
  },
  headerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  avatarWrapper: {
    position: 'relative',
    width: '3.5rem',
    height: '3.5rem',
    minWidth: '3.5rem',
  },
  editButton: (theme) => ({
    position: 'absolute',
    bottom: '-0.25rem',
    right: '-0.25rem',
    width: '1.5rem',
    height: '1.5rem',
    backgroundColor: theme.vars.palette.background.secondary,
    border: `.125rem solid ${theme.vars.palette.background.default}`,
    '&:hover': {
      backgroundColor: theme.vars.palette.background.dataGrid.main,
    },
  }),
  editIcon: ({ typography }) => ({
    fontSize: typography.labelSmall.fontSize,
  }),
  infoContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    minWidth: 0,
  },
  projectName: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  metaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
  },
  metaLabel: ({ typography }) => ({
    fontFamily: 'Montserrat, sans-serif',
    fontWeight: 400,
    fontSize: typography.headingSmall.fontSize,
    lineHeight: '1.5rem',
    color: 'text.primary',
    marginRight: '0.5rem',
  }),
  metaValue: ({ typography }) => ({
    fontFamily: 'Montserrat, sans-serif',
    fontWeight: 400,
    fontSize: typography.headingSmall.fontSize,
    lineHeight: '1.5rem',
    color: 'text.secondary',
  }),
});
