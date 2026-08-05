/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/BaseNode/NodeBodyContainer.jsx` (23 lines, unit A2e). Pure layout.
 *
 * DISCLOSED DEVIATION: the baseline passes `display`/`flexDirection`/
 * `padding`/`gap`/`width`/`boxSizing` as direct MUI `Box` system-shorthand
 * props (`<Box display={display} flexDirection="column" ...>`). Verified
 * empirically against this app's pinned `@mui/material@9.2.0` (rendered DOM
 * inspected under `renderWithTheme` in this unit's own test spike): those
 * props leak through as literal, non-functional HTML attributes
 * (`<div display="none" flexdirection="column" ...>`, no CSS applied at
 * all) instead of being translated into styles -- no other file anywhere in
 * `src/**` uses this shorthand-prop-on-`Box` pattern either (checked via
 * grep), confirming it is not a supported idiom in this app's `Box`. Ported
 * here as an equivalent `sx` object instead -- same values, same visual
 * result, the only way that actually styles anything in this app.
 *
 * R-T9 (raw px/rem in margin/padding/gap): `padding`/`gap` are expressed via
 * `theme.spacing(n)` instead of raw rem literals (this app's default
 * spacing unit is 8px = 0.5rem, same convention `NodeCardHeader.styles.ts`
 * documents) -- `1rem` uniform padding = `theme.spacing(2)`, `.75rem` gap =
 * `theme.spacing(1.5)`.
 */
import type { ReactNode } from 'react';
import { memo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface NodeBodyContainerProps {
  readonly children?: ReactNode;
  readonly display?: 'flex' | 'none';
}

const baseSx: SxProps<Theme> = (theme: Theme) => ({
  flexDirection: 'column',
  padding: theme.spacing(2),
  gap: theme.spacing(1.5),
  width: '100%',
  boxSizing: 'border-box',
});

export const NodeBodyContainer = memo(function NodeBodyContainer({
  children,
  display = 'flex',
}: NodeBodyContainerProps): ReactNode {
  return (
    <Box sx={[baseSx, { display }]}>{children}</Box>
  );
});
