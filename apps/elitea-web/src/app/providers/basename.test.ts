import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfigForTests } from '@/shared/config/get-config';

import { getAppBasename } from './basename';

/**
 * Env-stubbing technique matches unit F3's own C6 tests
 * (`src/shared/config/__tests__/get-config.test.ts`) and unit F4's DEV-gate
 * test (`src/shared/api/http.test.ts`): `vi.stubEnv` (which writes the real
 * `process.env`, the object `import.meta.env`'s vitest proxy is backed by —
 * see get-config.test.ts's header for why a plain property assignment on
 * `import.meta.env` is NOT safe to rely on here) plus `resetConfigForTests()`
 * so F3's memoized `getConfig()` re-resolves against the freshly stubbed
 * sources instead of returning a cached result from an earlier test.
 */
const ALL_KEYS = [
  'VITE_SERVER_URL',
  'VITE_BASE_URI',
  'VITE_SOCKET_SERVER',
  'VITE_SOCKET_PATH',
  'VITE_PUBLIC_PROJECT_ID',
] as const;

const g = globalThis as unknown as Record<string, unknown>;
const realProcessEnv = (g['process'] as { env: Record<string, string | undefined> }).env;

beforeEach(() => {
  resetConfigForTests();
  // Shell-provided VITE_* vars would leak into the resolved config; clear them (F3's own pattern).
  for (const key of ALL_KEYS) {
    delete realProcessEnv[key];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe('getAppBasename', () => {
  it('returns "" under import.meta.env.DEV, regardless of config', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_SERVER_URL', '/api/v2');
    vi.stubEnv('VITE_BASE_URI', '/app/');
    vi.stubEnv('VITE_PUBLIC_PROJECT_ID', 'proj-1');

    expect(getAppBasename()).toBe('');
  });

  it('returns config.vite_base_uri outside DEV when config resolves', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SERVER_URL', '/api/v2');
    vi.stubEnv('VITE_BASE_URI', '/app/');
    vi.stubEnv('VITE_PUBLIC_PROJECT_ID', 'proj-1');

    expect(getAppBasename()).toBe('/app/');
  });

  it('falls back to "" outside DEV when required config is missing (safe default — unreachable in practice, since App.tsx renders MissingEnvPage and returns before any router mounts)', () => {
    vi.stubEnv('DEV', false);
    // No VITE_* vars stubbed: all three required keys are absent.

    expect(getAppBasename()).toBe('');
  });
});
