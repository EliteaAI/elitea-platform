/**
 * ui/ContextBudgetPanel.tsx — the presentational half of the context-budget
 * panel: given already-narrowed `ContextBudgetStats`, render the production
 * layout (`widgets/context-budget/ui/ContextBudgetExpanded.jsx` +
 * `ContextBudgetHeader.jsx` + `ContextBudgetProgress.jsx` +
 * `ContextBudgetStatsDisplay.jsx` in the old app, collapsed into one file
 * here — those four components existed to be shared with the compact and
 * collapsed variants, neither of which this rail renders).
 *
 * No data fetching lives here, so the whole display surface is renderable
 * from a plain object in a test.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { AttentionIcon } from '@/shared/ui/icons/attention-icon';
import { InfoIcon } from '@/shared/ui/icons/info-icon';

import type { ContextBudgetStats } from '../lib/contextStatus';

/** @public */
export interface ContextBudgetPanelProps {
  readonly stats: ContextBudgetStats;
}

/**
 * The old app's `ContextBudgetStatsDisplay` hides every stat except
 * `Messages` when `maxTokens === 0` (the context manager is off for this
 * conversation, so summaries and the strategy do not apply). Kept.
 */
function visibleStatRows(stats: ContextBudgetStats): readonly { readonly key: string; readonly label: string; readonly value: string }[] {
  const messages = {
    key: 'messages',
    label: t('widgets.contextBudget.messages', 'Messages'),
    value: String(stats.messageGroups),
  };
  if (stats.maxTokens === 0) return [messages];
  return [
    messages,
    { key: 'summaries', label: t('widgets.contextBudget.summaries', 'Summaries'), value: String(stats.summariesGenerated) },
    { key: 'strategy', label: t('widgets.contextBudget.strategy', 'Strategy'), value: stats.strategyName },
  ];
}

export function ContextBudgetPanel({ stats }: ContextBudgetPanelProps): ReactNode {
  // The bar itself caps at 100%; the number above it does not (the old app
  // shows the true over-budget percentage and flags it with the warning icon).
  const barPercentage = Math.min(stats.utilizationPercentage, 100);

  return (
    <Box
      data-testid="context-budget-panel"
      sx={(theme: Theme) => ({
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        paddingY: theme.spacing(1),
        background: theme.vars.palette.background.secondary,
        border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        borderRadius: theme.vars.shape.radiusMd,
      })}
    >
      <Box sx={(theme: Theme) => ({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5), paddingX: theme.spacing(2) })}>
        <Typography
          variant="labelSmall"
          sx={(theme: Theme) => ({ color: theme.vars.palette.text.secondary })}
        >
          {t('widgets.contextBudget.title', 'Context Budget')}
        </Typography>
        <Tooltip
          title={t('widgets.contextBudget.info', 'Shows how much of your conversation context window is being used')}
          placement="top"
        >
          <Box sx={{ display: 'flex' }} data-testid="context-budget-info-icon">
            <InfoIcon width={16} height={16} />
          </Box>
        </Tooltip>
      </Box>

      <Box sx={(theme: Theme) => ({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5), paddingX: theme.spacing(2), paddingY: theme.spacing(1) })}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography
            variant="bodySmall2"
            data-testid="context-budget-tokens"
            sx={(theme: Theme) => ({ color: theme.vars.palette.text.secondary })}
          >
            {t('widgets.contextBudget.tokens', '{{tokens}} tokens', { tokens: stats.tokensDisplay })}
          </Typography>
          <Box sx={(theme: Theme) => ({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5) })}>
            <Typography
              variant="bodySmall2"
              data-testid="context-budget-utilization"
              sx={(theme: Theme) => ({ color: theme.vars.palette.text.secondary })}
            >
              {t('widgets.contextBudget.percentage', '{{percentage}}%', { percentage: stats.utilizationPercentage })}
            </Typography>
            {stats.isHighUtilization && (
              <Tooltip
                title={t('widgets.contextBudget.highUsage', 'Context usage is high. Consider configuring budget settings.')}
                placement="top-start"
              >
                <Box sx={{ display: 'flex' }} data-testid="context-budget-attention-icon">
                  <AttentionIcon width={16} height={16} />
                </Box>
              </Tooltip>
            )}
          </Box>
        </Box>
        <ProgressBar percentage={barPercentage} isHigh={stats.isHighUtilization} />
      </Box>

      {visibleStatRows(stats).map((row) => (
        <Box
          key={row.key}
          data-testid={`context-budget-stat-${row.key}`}
          sx={(theme: Theme) => ({ display: 'flex', alignItems: 'center', paddingX: theme.spacing(2) })}
        >
          <Typography
            variant="bodySmall2"
            sx={(theme: Theme) => ({ flex: 1, color: theme.vars.palette.text.default })}
          >
            {t('widgets.contextBudget.statLabel', '{{label}}:', { label: row.label })}
          </Typography>
          <Typography
            variant="bodySmall2"
            sx={(theme: Theme) => ({ color: theme.vars.palette.text.secondary, textTransform: 'capitalize' })}
          >
            {row.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function ProgressBar({ percentage, isHigh }: { readonly percentage: number; readonly isHigh: boolean }): ReactNode {
  return (
    <Box aria-hidden sx={{ height: '0.375rem', alignSelf: 'stretch', position: 'relative' }}>
      <Box
        sx={(theme: Theme) => ({
          position: 'absolute',
          inset: 0,
          backgroundColor: theme.vars.palette.border.lines,
          borderRadius: theme.vars.shape.radiusPill,
        })}
      />
      {/*
        * Decorative: the same number is already on screen as text
        * ("9%"), so a second `progressbar` role would only make a screen
        * reader read the figure twice. `data-percentage` is the width in a
        * form a test can read — the width itself lands in a generated class,
        * not in an inline style.
        */}
      <Box
        data-testid="context-budget-progress"
        data-percentage={percentage}
        sx={(theme: Theme) => ({
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${percentage}%`,
          backgroundColor: isHigh ? theme.vars.palette.warning.yellow : theme.vars.palette.success.main,
          borderRadius: theme.vars.shape.radiusPill,
        })}
      />
    </Box>
  );
}
