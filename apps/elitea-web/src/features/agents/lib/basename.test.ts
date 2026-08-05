import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfigForTests } from '@/shared/config/get-config';

import { getAgentsBasename } from './basename';

/** Same env-stubbing technique as `src/app/providers/basename.test.ts` — see its header for the full rationale. */
const ALL_KEYS = ['VITE_SERVER_URL', 'VITE_BASE_URI', 'VITE_SOCKET_SERVER', 'VITE_SOCKET_PATH', 'VITE_PUBLIC_PROJECT_ID'] as const;

const g = globalThis as unknown as Record<string, unknown>;
const realProcessEnv = (g['process'] as { env: Record<string, string | undefined> }).env;

beforeEach(() => {
  resetConfigForTests();
  for (const key of ALL_KEYS) {
    delete realProcessEnv[key];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe('getAgentsBasename', () => {
  it('returns "" under import.meta.env.DEV, regardless of config', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_SERVER_URL', '/api/v2');
    vi.stubEnv('VITE_BASE_URI', '/app/');
    vi.stubEnv('VITE_PUBLIC_PROJECT_ID', 'proj-1');

    expect(getAgentsBasename()).toBe('');
  });

  it('returns config.vite_base_uri outside DEV when config resolves', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SERVER_URL', '/api/v2');
    vi.stubEnv('VITE_BASE_URI', '/app/');
    vi.stubEnv('VITE_PUBLIC_PROJECT_ID', 'proj-1');

    expect(getAgentsBasename()).toBe('/app/');
  });

  it('falls back to "" outside DEV when required config is missing', () => {
    vi.stubEnv('DEV', false);

    expect(getAgentsBasename()).toBe('');
  });
});
