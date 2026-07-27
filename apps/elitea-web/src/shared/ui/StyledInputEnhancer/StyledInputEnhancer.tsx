import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import { BaseModal } from '../BaseModal';
import { InputBase, type InputBaseProps } from '../InputBase';
import { t } from '../lib/t';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface StyledInputEnhancerProps extends InputBaseProps {
  /** Modal title; falls back to the string `label`, then a generic default. */
  fullScreenTitle?: string;
}

/**
 * `InputBase` plus a full-screen editing modal, wired to the toolbar's
 * full-screen action. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/input/StyledInputEnhancer.jsx`.
 *
 * The baseline rendered its own bespoke `StyledInputModal` (CodeMirror,
 * language detection, F-string autocomplete, variable-state options — none
 * of which exist in `shared/ui` yet). This composes the two components this
 * unit actually owns instead: `InputBase` for the field, `BaseModal`
 * (`variant="complex"`, `fullscreen`) hosting a second, larger `InputBase`
 * as the expanded editor. Both instances are controlled from the same
 * `value`/`onChange`, so typing in either place stays in sync.
 *
 * The toolbar defaults to `forceShow: true` (`InputBase`'s own default is
 * hover-only) — this component's entire purpose is the full-screen escape
 * hatch, so gating its one action behind a mouse hover would make it
 * undiscoverable for keyboard/touch users and untestable without simulating
 * one. A caller can still pass `actions={{ forceShow: false }}` to restore
 * hover-only behaviour.
 */
export function StyledInputEnhancer({
  fullScreenTitle,
  label,
  value,
  onChange,
  actions,
  ...rest
}: StyledInputEnhancerProps): ReactNode {
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  const defaultTitle = t('shared.ui.styledInputEnhancer.title', 'Edit content');
  const modalTitle = fullScreenTitle ?? (typeof label === 'string' ? label : defaultTitle);
  const contentAriaLabel = typeof label === 'string' ? label : defaultTitle;

  return (
    <>
      <InputBase
        label={label}
        value={value}
        onChange={onChange}
        actions={{
          ...actions,
          enabled: actions?.enabled ?? true,
          forceShow: actions?.forceShow ?? true,
          showFullScreen: true,
        }}
        onFullScreen={handleOpen}
        {...rest}
      />
      <BaseModal
        open={open}
        onClose={handleClose}
        title={modalTitle}
        variant="complex"
        fullscreen
        content={
          <InputBase
            value={value}
            onChange={onChange}
            expand={{ minRows: 15, maxRows: 15 }}
            slotProps={{ htmlInput: { 'aria-label': contentAriaLabel } }}
            sx={{ height: '100%' }}
          />
        }
      />
    </>
  );
}
