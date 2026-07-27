import { forwardRef } from 'react';

import MuiTabs, { type TabsProps } from '@mui/material/Tabs';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export type BaseTabsProps = TabsProps;

/**
 * Thin `forwardRef` wrapper over MUI's `Tabs`. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/tabs/BaseTabs.jsx`. Styling lives in
 * `shared/brand/mui-overrides/MuiTabs.ts` (R-T12).
 */
export const BaseTabs = forwardRef<HTMLDivElement, BaseTabsProps>(function BaseTabs(
  { children, ...rest },
  ref,
) {
  return (
    <MuiTabs
      ref={ref}
      {...rest}
    >
      {children}
    </MuiTabs>
  );
});
