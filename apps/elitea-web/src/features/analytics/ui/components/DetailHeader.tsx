import { memo } from 'react';
import type { ReactNode } from 'react';

// `shared/ui/icons/` has no back-arrow glyph (only S2's 39 baseline-used
// icons were ported) — the same documented fallback pattern
// `shared/ui/CategoryFilter`/`ExpandedViewerModal` already use for a glyph
// outside that set (R-I1 only bans BARREL imports, not this).
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

/** Back button + entity-name heading shared by all three drill-down detail screens. */
export interface DetailHeaderProps {
  readonly entityName: string;
  readonly onBack: () => void;
}

const titleSx = (theme: Theme) => ({ color: theme.vars.palette.text.secondary });

function DetailHeaderImpl({ entityName, onBack }: DetailHeaderProps): ReactNode {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: (theme: Theme) => theme.spacing(1), marginBottom: (theme: Theme) => theme.spacing(1) }}>
      <IconButton
        onClick={onBack}
        size="small"
        aria-label={t('analytics.detail.backButton', 'Back')}
      >
        <ArrowBackIcon />
      </IconButton>
      <Typography
        variant="labelMedium"
        sx={titleSx}
      >
        {entityName}
      </Typography>
    </Box>
  );
}

export const DetailHeader = memo(DetailHeaderImpl);
