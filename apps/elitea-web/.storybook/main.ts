import { join } from 'node:path';

import type { StorybookConfig } from '@storybook/react-vite';

/**
 * spec §2.5 / §6.4 — Storybook 10.5.4 on the `@storybook/react-vite` framework.
 *
 * The old app (`apps/elitea-ui/.storybook/main.js:19`) imported
 * `@storybook/addon-a11y/preview` but never registered the addon here, and
 * set `a11y: { test: 'todo' }` in preview — so a real accessibility
 * violation could never fail a run. Both defects are fixed below: the addon
 * is registered, `addon-vitest` drives `npm run test:storybook`, and
 * `a11y.test` is `'error'` (set in `preview.tsx`, the project-level home for
 * parameters).
 *
 * `reactDocgen: 'react-docgen'` — D2 residual risk 3: `react-docgen-typescript`
 * against TypeScript 7's compiler API is unverified; the babel-based docgen
 * has no such dependency.
 */
const config: StorybookConfig = {
  stories: ['../src/shared/ui/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-vitest', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: {
        viteConfigPath: join(import.meta.dirname, '../vite.config.ts'),
      },
    },
  },
  typescript: {
    reactDocgen: 'react-docgen',
  },
  core: {
    disableWhatsNewNotifications: true,
  },
  staticDirs: [],
};

export default config;
