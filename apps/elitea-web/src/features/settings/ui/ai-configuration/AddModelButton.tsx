/**
 * AddModelButton — "+" button that navigates to the create-configuration flow.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/Configuration/AddModelButton.jsx`.
 */
import { useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

import { useNavigate } from '@tanstack/react-router';

import { t } from '@/shared/ui/lib/t';

export default function AddModelButton() {
  const navigate = useNavigate();

  const handleAdd = useCallback(() => {
    void navigate({
      to: '/settings/create-configuration',
      search: { from: 'model-configuration' },
      state: {
        routeStack: [
          {
            breadCrumb: 'AI Configuration',
            pagePath: '/settings/model-configuration',
          },
          {
            breadCrumb: 'New Configuration',
            pagePath: '/settings/create-configuration',
          },
        ],
      } as Record<string, unknown>,
    });
  }, [navigate]);

  return (
    <Tooltip
      title={t('ai-configuration.addModelTooltip', 'Create configuration')}
      placement="top"
    >
      <IconButton
        onClick={handleAdd}
        size="small"
        aria-label={t('ai-configuration.addModelTooltip', 'Create configuration')}
        sx={(theme) => ({
          width: '2rem',
          height: '2rem',
          color: theme.vars.palette.primary.main,
          border: `1px dashed ${theme.vars.palette.primary.main}`,
          '&:hover': {
            backgroundColor: `${theme.vars.palette.primary.main}12`,
            borderColor: theme.vars.palette.primary.dark,
          },
        })}
      >
        <AddIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
