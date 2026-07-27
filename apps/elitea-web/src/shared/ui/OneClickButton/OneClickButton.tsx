import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import { BaseBtn } from '../BaseBtn';
import { t } from '../lib/t';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface OneClickButtonProps {
  onClick?: () => void;
  title?: string;
  color?: 'primary' | 'secondary' | 'tertiary' | 'alarm';
  disabled?: boolean;
  disableRipple?: boolean;
}

/**
 * A button that permanently disables itself the first time it is clicked —
 * for one-shot actions a double-click (or a slow network response) must not
 * repeat. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/button/OneClickButton.jsx`.
 * Colour/geometry come from `shared/brand/mui-overrides/MuiButton.ts`'s
 * `elitea` entries (unit S1 Part B) — this component owns no
 * `styled()`/variant styling of its own.
 */
export function OneClickButton({
  onClick,
  title,
  color,
  disabled,
  disableRipple,
}: OneClickButtonProps): ReactNode {
  const [isClicked, setIsClicked] = useState(false);

  const handleClick = useCallback(() => {
    onClick?.();
    setIsClicked(true);
  }, [onClick]);

  return (
    <BaseBtn
      variant="elitea"
      color={color}
      disabled={isClicked || disabled}
      onClick={handleClick}
      disableRipple={disableRipple}
    >
      {title ?? t('shared.ui.oneClickButton.title', 'Button')}
    </BaseBtn>
  );
}
