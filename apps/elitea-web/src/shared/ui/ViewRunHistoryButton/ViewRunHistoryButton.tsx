import type { MouseEvent, ReactNode } from 'react';
import { useCallback } from 'react';

import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';

import { ClockIcon } from '../icons/clock-icon';
import { t } from '../lib/t';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface ViewRunHistoryButtonProps {
  onShowHistory?: (event: MouseEvent<HTMLButtonElement>) => void;
  'data-testid'?: string;
  /** `data-*` hook for a product-tour library to target this button. */
  dataTour?: string;
}

/**
 * A small round icon button that opens a pipeline/agent's run history.
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/button/ViewRunHistoryButton.jsx`.
 * Colour/geometry come from `shared/brand/mui-overrides/MuiIconButton.ts`
 * — this component owns no `styled()`/variant styling of its own.
 *
 * Two deviations from the baseline, both forced by the same rule
 * (`shared/ui` cannot import `features/` — layer rule R-L1):
 *  - `IconButton` has no typed `variant` prop (`MuiIconButton.ts`'s own doc
 *    comment), so this passes `color="secondary"` only, not the baseline's
 *    `variant="elitea" color="secondary"`.
 *  - the baseline hard-codes `data-tour={SHARED_TOUR_TARGET_IDS.runHistory}`,
 *    a features-layer constant. `dataTour` is an optional prop instead — a
 *    features-layer caller that wires up product tours passes its own
 *    constant through it.
 */
export function ViewRunHistoryButton({
  onShowHistory,
  'data-testid': dataTestId = 'pipeline-history-tab',
  dataTour,
}: ViewRunHistoryButtonProps): ReactNode {
  const handleShowHistory = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onShowHistory?.(event);
    },
    [onShowHistory],
  );

  const label = t('shared.ui.viewRunHistoryButton.label', 'View run history');

  return (
    <Tooltip
      title={label}
      placement="top"
    >
      <IconButton
        color="secondary"
        aria-label={label}
        data-testid={dataTestId}
        data-tour={dataTour}
        onClick={handleShowHistory}
      >
        <SvgIcon
          component={ClockIcon}
          inheritViewBox
        />
      </IconButton>
    </Tooltip>
  );
}
