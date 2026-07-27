import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfigForTests } from '@/shared/config/get-config';

import { createAppRouter } from './router';

describe('createAppRouter', () => {
  beforeEach(() => {
    resetConfigForTests();
    // getAppBasename() returns '' unconditionally under import.meta.env.DEV
    // (unit R2's own basename.ts); stub it false so the config-derived
    // branch this test exercises actually runs, matching R2's own
    // basename.test.ts technique.
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SERVER_URL', 'https://elitea.example');
    vi.stubEnv('VITE_BASE_URI', '/app/');
    vi.stubEnv('VITE_PUBLIC_PROJECT_ID', '11');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigForTests();
  });

  it('builds a router with the generated route tree, stub auth context, and default pending/error components', () => {
    const router = createAppRouter();

    expect(router.routeTree).toBeDefined();
    expect(router.options.context?.auth.getUser()).toBeUndefined();
    expect(router.options.context?.auth.getSelectedProjectId()).toBeUndefined();
    expect(router.options.defaultPendingComponent).toBeDefined();
    expect(router.options.defaultErrorComponent).toBeDefined();
    expect(router.options.defaultPreload).toBe('intent');
  });

  it('resolves basepath from config (spec §7.1 C3)', () => {
    const router = createAppRouter();
    expect(router.basepath).toBe('/app/');
  });

  it('falls back to a root basepath when config is missing (unreachable in practice — App.tsx renders MissingEnvPage first)', () => {
    vi.unstubAllEnvs();
    vi.stubEnv('DEV', false);
    // No VITE_* vars stubbed: all three required config keys are absent.
    resetConfigForTests();
    const router = createAppRouter();
    // getAppBasename()'s own documented fallback is '' (not TanStack's own
    // `/` default) — passing '' explicitly overrides that default. TanStack
    // Router itself normalises basepath internally when matching, so this
    // still resolves paths correctly at the root.
    expect(router.basepath).toBe('');
  });
});
