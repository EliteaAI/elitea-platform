import type { ReactNode } from 'react';

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

import type { SkillRecord } from '../model/types';

export interface SkillsListProps {
  readonly items: readonly SkillRecord[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly query: string;
  readonly onSelect: (skillId: string) => void;
  readonly onDelete: (skill: SkillRecord) => void;
  readonly onExport: (skill: SkillRecord) => void;
}

export function SkillsList({
  items,
  isLoading,
  isError,
  query,
  onSelect,
  onDelete,
  onExport,
}: SkillsListProps): ReactNode {
  if (isLoading) return <Typography>{t('skills.list.loading', 'Loading skills…')}</Typography>;
  if (isError) {
    return (
      <Typography role="alert">{t('skills.list.error', 'Failed to load skills.')}</Typography>
    );
  }
  if (items.length === 0) {
    return (
      <NoResultsMessage
        title={
          query.trim()
            ? t('skills.list.noMatches', 'No matching skills.')
            : t('skills.list.empty', 'No skills yet')
        }
        description={t(
          'skills.list.emptyDescription',
          'Skills are reusable Markdown instructions you can attach to agents.',
        )}
      />
    );
  }

  return (
    <List sx={listSx}>
      {items.map((skill) => (
        <ListItem
          key={skill.id}
          disablePadding
          secondaryAction={
            <Box sx={actionsSx}>
              <Tooltip title={t('skills.list.export', 'Export')}>
                <IconButton
                  aria-label={t('skills.list.export', 'Export')}
                  onClick={() => {
                    onExport(skill);
                  }}
                >
                  <DownloadOutlinedIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('skills.list.delete', 'Delete')}>
                <IconButton
                  aria-label={t('skills.list.delete', 'Delete')}
                  onClick={() => {
                    onDelete(skill);
                  }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Tooltip>
            </Box>
          }
        >
          <ListItemButton
            data-testid="skill-list-row"
            onClick={() => {
              onSelect(skill.id);
            }}
          >
            <ListItemText
              primary={skill.name || t('skills.list.untitled', 'Untitled skill')}
              secondary={skill.description ?? ''}
            />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );
}

const listSx: SxProps<Theme> = (theme: Theme) => ({
  border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  borderRadius: theme.vars.shape.radiusMd,
});
const actionsSx: SxProps<Theme> = { display: 'flex', alignItems: 'center' };
