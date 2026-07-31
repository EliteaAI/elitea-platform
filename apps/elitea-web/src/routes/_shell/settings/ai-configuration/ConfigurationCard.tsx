/**
 * ConfigurationCard — displays a single configuration/model card.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/Configuration/ConfigurationCard.jsx`.
 */
import { memo, useCallback, useMemo } from 'react';
import { useTheme, type Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { GradientIconWrapper } from '@/shared/ui/GradientIconWrapper';
import { t } from '@/shared/ui/lib/t';
import {
  getConfigurationDisplayName,
  getConfigurationStatus,
  isConfigurationEditable,
  getIconTypeKey,
} from '@/routes/_shell/settings/ai-configuration/configuration.helpers';

const CONFIG_PROVIDER_ICONS: Record<string, { path: string }> = {
  VERTEX_AI: {
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  },
  AI_DIAL: {
    path: 'M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-10-7h9v6h-9z',
  },
  OPEN_AI: {
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z',
  },
  CLAUDE: {
    path: 'M9.5 2c-1.1 0-2 .9-2 2v1c0 1.1.9 2 2 2h.5c.3-1.2 1.1-2.2 2.1-2.8C10.6 3.4 8.7 2.2 6.5 2H9.5zm1 4h3v2h-3V6zm-3 1h2v4h-2V7zm4 0h2v4h-2V7zm-3.5 5c-1.4 0-2.5 1.1-2.5 2.5S5.1 17 6.5 17H9.5v-4h-3zm4.5 0v4H12c.8 0 1.5-.7 1.5-1.5V12h-1v3zm3-2.5c-1.4 0-2.5 1.1-2.5 2.5s1.1 2.5 2.5 2.5h1.5v-5H15zm-3 1h2v3h-2v-3zM7 13.5C7 12.1 8.1 11 9.5 11h.5v4H9.5C8.1 15 7 13.9 7 12.5zm3 1v-2h1v2h-1z',
  },
  OLLAMA: {
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  },
  AMAZON_BEDROCK: {
    path: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z',
  },
  AMAZON: {
    path: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12z',
  },
  HUGGING_FACE: {
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l7.51-3.49L17.5 6.5 9.99 9.99 6.5 17.5zm5.5-6c.83 0 1.5-.67 1.5-1.5S13.33 7 12.5 7 11 7.67 11 8.5s.67 1.5 1.5 1.5z',
  },
  CHROMA: {
    path: 'M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z',
  },
  AZURE: {
    path: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z',
  },
  PGVECTOR: {
    path: 'M4 22h16a2 2 0 002-2V2H2v18a2 2 0 002 2zm1-13h12v2H5V9zm0 4h8v2H5v-2zm0-8h12v2H5V5z',
  },
};

const resolveIconPath = (iconType: string): string => {
  return CONFIG_PROVIDER_ICONS[iconType]?.path ?? '';
};

const ProviderIcon = memo(({ iconType }: { iconType: string }) => {
  const path = resolveIconPath(iconType);
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      sx={{ width: '1.25rem', height: '1.25rem', fill: 'currentColor' }}
      dangerouslySetInnerHTML={{ __html: `<path d="${path}" />` }}
    />
  );
});

ProviderIcon.displayName = 'ProviderIcon';

export interface ConfigurationCardProps {
  configuration: Record<string, unknown>;
  canEdit: boolean;
  isDefault: boolean;
  onClick?: (configurationId: string) => void;
}

export default memo(
  ({ configuration, canEdit, isDefault, onClick }: ConfigurationCardProps) => {
    const theme = useTheme();
    const styles = getStyles(theme);
    const configData = (configuration.data ?? {}) as Record<string, unknown>;
    const isShared = configuration.shared === true;

    const disabled = useMemo(() => {
      return !isConfigurationEditable(configuration, configuration.project_id as string, canEdit);
    }, [canEdit, configuration]);

    const displayName = useMemo(() => getConfigurationDisplayName(configuration), [configuration]);
    const statusText = useMemo(() => getConfigurationStatus(configuration.default === true || false, isShared), [configuration, isShared]);

    const handleCardClick = useCallback(() => {
      if (!disabled) {
        onClick?.(configuration.id as string);
      }
    }, [disabled, onClick, configuration.id]);

    const iconType = getIconTypeKey(
      configuration.name as string | undefined,
      configuration.type as string | undefined,
      configuration.label as string | undefined,
    );

    return (
      <Box
        onClick={handleCardClick}
        sx={styles.cardContainer(disabled)}
      >
        <Box sx={styles.content}>
          <Box sx={styles.iconContainer}>
            <GradientIconWrapper size="2.75rem">
              <ProviderIcon iconType={iconType} />
            </GradientIconWrapper>
          </Box>
          <Box sx={styles.textContainer}>
            <Box sx={styles.titleRow}>
              <Typography variant="bodyMedium" color="text.secondary" sx={styles.displayName}>
                {displayName}
              </Typography>
              {disabled && (
                <Typography variant="bodySmall" color="text.disabled" sx={styles.disabledLabel}>
                  {t('ai-configuration.card.noPermissions', 'No edit permissions')}
                </Typography>
              )}
            </Box>
            <Typography variant="bodySmall" color="text.default" sx={styles.statusText}>
              {statusText}
              {(configData.high_tier as boolean) && (
                <Typography variant="bodySmall" color="text.secondary" sx={styles.badge}>
                  {t('ai-configuration.card.highTier', 'High-Tier')}
                </Typography>
              )}
              {(configData.low_tier as boolean) && (
                <Typography variant="bodySmall" color="text.secondary" sx={styles.badge}>
                  {t('ai-configuration.card.lowTier', 'Low-Tier')}
                </Typography>
              )}
              {isDefault && (
                <Typography variant="bodySmall" color="text.secondary" sx={styles.badge}>
                  {t('ai-configuration.card.default', 'Default')}
                </Typography>
              )}
            </Typography>
          </Box>
        </Box>
      </Box>
    );
  },
);

function getStyles(theme: ReturnType<typeof useTheme>) {
  const t = theme as Theme;
  return {
    cardContainer: (disabled: boolean) => ({
      boxSizing: 'border-box',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flex: '0 0 calc((100% - 1.5rem) / 3)',
      maxWidth: 'calc((100% - 1.5rem) / 3)',
      minWidth: '20rem',
      background: `linear-gradient(135deg, ${t.vars.palette.background.eliteaDefault} 0%, ${t.vars.palette.border.lines} 100%)`,
      border: '1px solid transparent',
      borderRadius: 'var(--el-shape-radiusMd, 8px)',
      padding: '0.5rem',
      cursor: disabled ? 'default' : 'pointer',
      transition: 'all 0.2s ease-in-out',
      '&:hover': !disabled ? {
        border: `1px solid ${t.vars.palette.scrollbar.thumb}`,
        backgroundColor: t.vars.palette.background.eliteaDefault,
      } : {},
      '@media (max-width: 1200px)': {
        flex: '0 0 calc((100% - 1.5rem) / 2)',
        maxWidth: 'calc((100% - 1.5rem) / 2)',
      },
      '@media (max-width: 960px)': {
        flex: '0 0 100%',
        maxWidth: '100%',
      },
    }),
    content: {
      display: 'flex',
      padding: '0.75rem 0.5rem',
      gap: '0.75rem',
      width: '100%',
      alignItems: 'center',
    },
    iconContainer: {
      flexShrink: 0,
    },
    textContainer: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      flex: 1,
      minWidth: 0,
    },
    titleRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      minWidth: 0,
    },
    displayName: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontWeight: 500,
    },
    disabledLabel: {
      marginLeft: 'auto',
      flexShrink: 0,
    },
    statusText: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: 'flex',
      gap: '0.625rem',
      alignItems: 'center',
    },
    badge: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--el-shape-radiusLg, 16px)',
      padding: '0.125rem 0.5rem',
    },
  };
}
