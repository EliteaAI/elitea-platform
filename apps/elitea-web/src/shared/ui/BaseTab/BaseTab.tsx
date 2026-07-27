import { forwardRef } from 'react';

import MuiTab, { type TabProps } from '@mui/material/Tab';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export type BaseTabProps = TabProps;

/**
 * Thin `forwardRef` wrapper over MUI's `Tab`. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/tabs/BaseTab.jsx`. Styling lives in
 * `shared/brand/mui-overrides/MuiTab.ts` (R-T12).
 */
export const BaseTab = forwardRef<HTMLDivElement, BaseTabProps>(function BaseTab(
  { iconPosition = 'start', ...rest },
  ref,
) {
  return (
    <MuiTab
      ref={ref}
      iconPosition={iconPosition}
      {...rest}
    />
  );
});
