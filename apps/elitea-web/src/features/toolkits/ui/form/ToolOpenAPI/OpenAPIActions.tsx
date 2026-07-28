import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { combineSx } from '@/shared/ui/lib/combineSx';

import { OpenAPIActionsTable } from './OpenAPIActionsTable';
import type { OpenAPIAction } from './OpenAPIActionsTable';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/
 * ToolOpenAPI/OpenAPIActions.jsx` (69 lines) — a single-panel accordion
 * ("Api Endpoints") wrapping `OpenAPIActionsTable`.
 *
 * `AccordionConstants.AccordionShowMode.LeftMode` -> `shared/ui`'s own
 * `AccordionShowMode` union (`'left' | 'right'`) — same value, `'left'`,
 * just a plain string literal instead of a baseline constants-object member
 * (`BasicAccordion`'s own `showMode` prop, `shared/ui/StyledAccordionSummary`).
 *
 * DISCLOSED DROP: the baseline's `accordionSX`/`summarySX` (a
 * `background.tabPanel` fill plus a `.MuiAccordionSummary-content`
 * padding/alignment tweak, both `!important`) are NOT ported. This app's
 * lint rules (`R-T5 no-important-sx`, `R-T6 no-mui-internal-selector`) ban
 * both outright — an internal-selector/`!important` override may only live
 * in `shared/brand/mui-overrides/` (one file per component key), which is
 * outside a settings-form sub-unit's ownership fence. `BasicAccordion`'s
 * own default styling is used unmodified instead; a real, disclosed, purely
 * cosmetic gap (panel background/summary padding), not a functional one.
 */
export interface OpenAPIActionsProps {
  readonly tools?: readonly OpenAPIAction[];
  readonly selected_tools?: readonly OpenAPIAction[];
  readonly sx?: SxProps<Theme>;
}

const baseContainerSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', marginTop: '0.5rem' };

export function OpenAPIActions({ tools, selected_tools, sx }: OpenAPIActionsProps): ReactNode {
  return (
    <Box sx={combineSx(baseContainerSx, sx)}>
      <BasicAccordion
        showMode="left"
        items={[
          {
            title: t('features.toolkits.openApiActions.apiEndpoints', 'Api Endpoints'),
            content: (
              <OpenAPIActionsTable
                {...(tools !== undefined ? { tools } : {})}
                {...(selected_tools !== undefined ? { selected_tools } : {})}
              />
            ),
          },
        ]}
      />
    </Box>
  );
}
