import type { SxProps, Theme } from '@mui/material/styles';

import { PipelineEditorMode } from '@/shared/lib/enums';

/**
 * `FlowWrapper.tsx`'s own `sx` computation, extracted to a file with NO
 * dependency on `./FlowEditor` (unit A2k). Split out purely so this pure,
 * real logic stays unit-testable in isolation: `FlowWrapper.tsx` itself
 * statically imports `FlowEditor` (matching the baseline's own
 * `FlowWrapper.jsx`, which also statically imports `FlowEditor.jsx` — no
 * double lazy-loading), and `FlowEditor`'s current transitive dependency
 * chain has a real, verified, out-of-this-sub-unit's-scope runtime
 * module-resolution failure: `ui/state/RunStateDialog.status.tsx` imports a
 * non-existent `@mui/icons-material/ErrorOutline` (confirmed:
 * `find node_modules/@mui/icons-material -iname 'ErrorOutline*'` finds no
 * exact match) — a real, pre-existing bug in a sibling sub-unit's file
 * (unit A2k), well outside this sub-unit's (A2n) owned-file fence, not
 * something this file can or should fix. Any test file that
 * even TOUCHES `FlowWrapper.tsx` (regardless of what it actually imports
 * from it) forces Vite to resolve that whole broken chain at module-load
 * time and crashes before any test runs — reproduced directly. Living in
 * its own file with zero `FlowEditor` dependency, this logic stays real,
 * mock-free (`no-vi-mock`/R-M1 forbids substituting it instead), unit-tested
 * coverage of `FlowWrapper`'s only actual logic (everything else in that
 * file is pure prop pass-through to `FlowEditor`).
 */
export type PipelineEditorModeValue = (typeof PipelineEditorMode)[keyof typeof PipelineEditorMode];

export function computeFlowWrapperSx(isSmallWindow: boolean, noBorder: boolean, mode: PipelineEditorModeValue): SxProps<Theme> {
  return {
    width: '100%',
    minHeight: isSmallWindow ? 'calc(100vh - 220px)' : undefined,
    height: 'calc(100% - 40px)',
    flex: 1,
    border: ({ vars }) => (noBorder ? 'none' : `0.0625rem solid ${vars.palette.border.lines}`),
    borderTop: ({ vars }) => (noBorder ? `0.0625rem solid ${vars.palette.border.lines}` : undefined),
    borderRadius: noBorder ? '0' : ({ vars }) => vars.shape.radiusMd,
    overflow: 'hidden',
    display: mode === PipelineEditorMode.Flow ? undefined : 'none',
  };
}
