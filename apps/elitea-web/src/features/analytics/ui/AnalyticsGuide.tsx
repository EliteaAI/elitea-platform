import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { GUIDE_SECTIONS } from '../lib/constants';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsGuide.jsx`.
 * The "Guide" tab: a static, purely explanatory reference for every metric
 * on the other five tabs. No data fetching (per COPY-054's manifest slice —
 * this component's only job is rendering `GUIDE_SECTIONS` verbatim).
 */

const cardSx = (theme: Theme) => ({
  padding: theme.spacing(2),
  borderRadius: theme.vars.shape.radiusMd,
  backgroundColor: theme.vars.palette.background.userInputBackground,
  border: `1px solid ${theme.vars.palette.border.table}`,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

const sectionTitleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
  fontSize: theme.typography.headingMedium.fontSize,
  fontWeight: 600,
  marginBottom: theme.spacing(1.5),
  paddingBottom: theme.spacing(1),
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
});

const itemSx = (theme: Theme) => ({
  padding: `${theme.spacing(1.5)} 0`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  '&:last-child': { borderBottom: 'none' },
});

const nameSx = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
  fontWeight: 600,
  marginBottom: theme.spacing(0.75),
  display: 'block',
});

const descriptionSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  lineHeight: 1.6,
  whiteSpace: 'pre-line',
});

const calcRowSx = (theme: Theme) => ({
  display: 'flex',
  gap: theme.spacing(1),
  alignItems: 'baseline',
  marginTop: theme.spacing(0.75),
});

const calcLabelSx = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
  fontSize: theme.typography.labelSmall.fontSize,
  fontWeight: 600,
  flexShrink: 0,
});

const calcValueSx = (theme: Theme) => ({
  color: theme.vars.palette.text.link,
  fontSize: theme.typography.bodyMedium.fontSize,
});

function AnalyticsGuideImpl(): ReactNode {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: (theme: Theme) => theme.spacing(2) }}>
      {GUIDE_SECTIONS.map((section) => (
        <Box
          key={section.title}
          sx={cardSx}
        >
          <Typography
            variant="labelMedium"
            sx={sectionTitleSx}
          >
            {section.title}
          </Typography>
          {section.metrics.map((metric) => (
            <Box
              key={metric.name}
              sx={itemSx}
            >
              <Typography
                variant="bodyMedium"
                sx={nameSx}
              >
                {metric.name}
              </Typography>
              <Typography
                variant="bodySmall"
                sx={descriptionSx}
              >
                {metric.description}
              </Typography>
              {metric.calculation !== undefined && (
                <Box sx={calcRowSx}>
                  <Typography
                    variant="labelSmall"
                    sx={calcLabelSx}
                  >
                    {t('analytics.guide.calculationLabel', 'Calculation:')}
                  </Typography>
                  <Typography
                    variant="bodySmall"
                    sx={calcValueSx}
                  >
                    {metric.calculation}
                  </Typography>
                </Box>
              )}
              {metric.source !== undefined && (
                <Box sx={calcRowSx}>
                  <Typography
                    variant="labelSmall"
                    sx={calcLabelSx}
                  >
                    {t('analytics.guide.sourceLabel', 'Data source:')}
                  </Typography>
                  <Typography
                    variant="bodySmall"
                    sx={calcValueSx}
                  >
                    {metric.source}
                  </Typography>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export const AnalyticsGuide = memo(AnalyticsGuideImpl);
