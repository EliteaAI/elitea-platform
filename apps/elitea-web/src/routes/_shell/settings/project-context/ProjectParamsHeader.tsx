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
import { useCallback, useState } from 'react';

import EditIcon from '@mui/icons-material/Edit';

import { useProjectInfoQuery } from '@/entities/project/api/projectContextApi';
import { t } from '@/shared/i18n';

import { ProjectIconDialog } from './ProjectIconDialog';

export interface ProjectParamsHeaderProps {
  projectId: string;
  projectName: string;
  /** Called when the user selects an icon — parent persists via updateProjectInfo. */
  onIconChange?: (iconName: string | null) => void;
}

export function ProjectParamsHeader({
  projectId,
  projectName,
  onIconChange,
}: ProjectParamsHeaderProps) {
  const [iconDialogOpen, setIconDialogOpen] = useState(false);
  const { data: projectInfo } = useProjectInfoQuery(projectId, {
    enabled: !!projectId,
  });

  const iconMeta = projectInfo?.icon_meta;
  const teammatesCount = projectInfo?.teammates_count ?? 0;
  const sx = styles();

  const handleOpenIconDialog = useCallback(() => {
    setIconDialogOpen(true);
  }, []);

  const handleCloseIconDialog = useCallback(() => {
    setIconDialogOpen(false);
  }, []);

  const handleIconSelect = useCallback(
    (iconName: string | null) => {
      onIconChange?.(iconName);
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
          <IconButton
            sx={sx.editButton}
            onClick={handleOpenIconDialog}
          >
            <EditIcon sx={sx.editIcon} />
          </IconButton>
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
              >
                {teammatesCount}
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

const avatarSx: SxProps<Theme> = {
  width: '3.5rem',
  height: '3.5rem',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1.5rem',
  fontWeight: 600,
  color: 'text.primary',
  backgroundColor: 'action.selected',
};

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
  editButton: ({ palette }) => ({
    position: 'absolute',
    bottom: '-0.25rem',
    right: '-0.25rem',
    width: '1.5rem',
    height: '1.5rem',
    backgroundColor: palette.background.secondary,
    border: `.125rem solid ${palette.background.default}`,
    '&:hover': {
      backgroundColor: palette.background.dataGrid.main,
    },
  }),
  editIcon: {
    fontSize: '0.75rem',
  },
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
  metaLabel: () => ({
    fontFamily: 'Montserrat, sans-serif',
    fontWeight: 400,
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
    color: 'text.primary',
    marginRight: '0.5rem',
  }),
  metaValue: () => ({
    fontFamily: 'Montserrat, sans-serif',
    fontWeight: 400,
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
    color: 'text.secondary',
  }),
});
