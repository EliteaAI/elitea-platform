import { setProjectAnnotations } from '@storybook/react-vite';
import * as a11yAddonAnnotations from '@storybook/addon-a11y/preview';

import * as projectAnnotations from './preview';

/**
 * spec §6.4 — wires `.storybook/preview.tsx`'s project annotations (theme
 * decorator, `a11y.test: 'error'`) plus the a11y addon's own annotations
 * into the `storybook` Vitest project (`vitest.config.ts`). The addon-vitest
 * plugin loads Storybook's `beforeAll` automatically (Storybook 10 —
 * confirmed via context7 `/storybookjs/storybook`), so no manual `beforeAll`
 * call belongs here.
 */
setProjectAnnotations([a11yAddonAnnotations, projectAnnotations]);
