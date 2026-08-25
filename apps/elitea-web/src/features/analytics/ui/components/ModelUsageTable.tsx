import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import type { ModelUsage } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';

import { pickChartColor } from '../../lib/constants';
import { fmtNum } from '../../lib/format';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/components/ModelUsageTable.jsx`.
 *
 * Field mapping vs. the baseline (see this unit's final report): the real
 * `ModelUsage` type (`src/shared/api/generated/model/modelUsage.zod.ts`,
 * `internal/domain/analytics/types.go`) is
 * `{model, provider, prompt_tokens, completion_tokens, run_count}` — the
 * baseline read `.calls`/`.users`/`.display_name`/`.model_name`, none of
 * which exist on this type. `run_count` substitutes for `.calls` and
 * `model` for the display name.
 *
 * ── THE "USERS" COLUMN IS GONE, NOT EMPTY ──
 *
 * It was a header kept for parity over a cell that always rendered
 * `UNAVAILABLE_METRIC`: a column of dashes, once per model, forever. There is
 * no per-model user count anywhere in this domain — the gateway request log
 * groups by model or by user, never both in one row here — so the column was a
 * question this table can never answer, taking up a fifth of its width and
 * inviting the reader to wonder what was broken. TOKENS replaces it, which is a
 * figure the same row already carries.
 *
 * There is no COST column either, for a different reason: money is keyed by
 * (scope, scope_id, period) in the budget accumulator and has no model
 * dimension at all, so a per-model cost cannot be derived from anything this
 * platform writes. The schema dropped `total_cost` from `ModelUsage` rather
 * than let a zero read as "this model was free".
 */
export interface ModelUsageTableProps {
  readonly models: readonly ModelUsage[];
  readonly totalCalls: number;
}

const cardSx = (theme: Theme) => ({
  padding: theme.spacing(2),
  borderRadius: theme.vars.shape.radiusMd,
  backgroundColor: theme.vars.palette.background.userInputBackground,
  border: `1px solid ${theme.vars.palette.border.table}`,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

const titleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
  marginBottom: theme.spacing(0.5),
  display: 'block',
});

const subtitleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.labelSmall.fontSize,
  marginBottom: theme.spacing(1),
  display: 'block',
});

const headerRowSx = (theme: Theme) => ({
  display: 'flex',
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  gap: theme.spacing(1),
});

const headerCellSx = (theme: Theme) => ({
  fontSize: theme.typography.labelSmall.fontSize,
  fontWeight: 600,
  color: theme.vars.palette.text.metrics,
  textTransform: 'uppercase',
});

const rowSx = (theme: Theme) => ({
  display: 'flex',
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  gap: theme.spacing(1),
  '&:hover': { backgroundColor: theme.vars.palette.background.conversation.hover },
});

const cellValueSx = (theme: Theme) => ({
  fontSize: theme.typography.bodyMedium.fontSize,
  color: theme.vars.palette.text.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const providerSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.labelSmall.fontSize,
  flexShrink: 0,
});

const shareBarBgSx = (theme: Theme) => ({
  flex: 1,
  height: 8,
  borderRadius: theme.vars.shape.radiusSm,
  backgroundColor: theme.vars.palette.background.conversation.normal,
  overflow: 'hidden',
});

const shareLabelSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  minWidth: '2.5rem',
  textAlign: 'right' as const,
});

function ModelUsageTableImpl({ models, totalCalls }: ModelUsageTableProps): ReactNode {
  if (models.length === 0) return null;

  // `||`, not `??`: a real top-ranked model with `run_count: 0` (every
  // model unused in the selected date range) must still fall back to `1`
  // so the share-bar width below is `0 / 1 = 0%`, not `0 / 0 = NaN%`.
  // Matches the baseline's `models[0]?.calls || 1`
  // (`apps/elitea-ui/.../ModelUsageTable.jsx:15`).
  const maxCalls = models[0]?.run_count || 1;

  return (
    <Box sx={cardSx}>
      <Typography
        variant="labelMedium"
        sx={titleSx}
      >
        {t('analytics.overview.modelUsage.title', 'Model Usage Breakdown')}
      </Typography>
      <Typography
        variant="bodySmall"
        sx={subtitleSx}
      >
        {t('analytics.overview.modelUsage.subtitle', 'LLM calls per model')}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'auto' }}>
        <Box sx={headerRowSx}>
          <Typography sx={combineSx(headerCellSx, { flex: '0 0 2rem' })}>#</Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 3 })}>
            {t('analytics.overview.modelUsage.columnModel', 'Model')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 1, textAlign: 'right' })}>
            {t('analytics.overview.modelUsage.columnCalls', 'Calls')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 1, textAlign: 'right' })}>
            {t('analytics.overview.modelUsage.columnTokens', 'Tokens')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 2 })}>
            {t('analytics.overview.modelUsage.columnShare', 'Share')}
          </Typography>
        </Box>
        {models.map((model, index) => {
          const share = totalCalls > 0 ? (model.run_count / totalCalls) * 100 : 0;
          const color = pickChartColor(index);

          return (
            <Box
              key={`${model.provider}/${model.model}-${index}`}
              sx={rowSx}
            >
              <Typography sx={combineSx(cellValueSx, { flex: '0 0 2rem', color: (theme: Theme) => theme.vars.palette.text.metrics })}>
                {index + 1}
              </Typography>
              <Box sx={combineSx(cellValueSx, { flex: 3, display: 'flex', alignItems: 'center', gap: 1 })}>
                <Box
                  sx={(theme: Theme) => ({ width: 8, height: 8, borderRadius: theme.vars.shape.radiusPill, backgroundColor: color, flexShrink: 0 })}
                />
                <Typography
                  variant="bodySmall"
                  noWrap
                >
                  {model.model}
                </Typography>
                {model.provider !== '' && (
                  // The same model name can arrive through two providers (an
                  // OpenAI model served directly and through Azure, say), and
                  // the rows are grouped by the PAIR — so without this they
                  // read as a duplicate row rather than as two routes.
                  <Typography
                    variant="bodySmall"
                    noWrap
                    sx={providerSx}
                  >
                    {model.provider}
                  </Typography>
                )}
              </Box>
              <Typography sx={combineSx(cellValueSx, { flex: 1, textAlign: 'right' })}>
                {fmtNum(model.run_count)}
              </Typography>
              <Typography sx={combineSx(cellValueSx, { flex: 1, textAlign: 'right' })}>
                {fmtNum(model.prompt_tokens + model.completion_tokens)}
              </Typography>
              <Box sx={{ flex: 2, display: 'flex', alignItems: 'center', gap: 1, paddingLeft: 1 }}>
                <Box sx={shareBarBgSx}>
                  <Box
                    sx={{
                      height: '100%',
                      borderRadius: (theme: Theme) => theme.vars.shape.radiusSm,
                      transition: 'width 0.3s ease',
                      width: `${(model.run_count / maxCalls) * 100}%`,
                      backgroundColor: color,
                    }}
                  />
                </Box>
                <Typography
                  variant="bodySmall"
                  sx={shareLabelSx}
                >
                  {share.toFixed(1)}%
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export const ModelUsageTable = memo(ModelUsageTableImpl);
