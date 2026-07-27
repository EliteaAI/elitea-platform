import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext, AuthUser, RouterContext } from '@/app/router-context';
import { resetConfigForTests } from '@/shared/config/get-config';

import { decideIndexRoute } from '../-guards/indexRoute';
import { integrationGuardBeforeLoad } from '../-guards/integrationGuard';
import { isPublicProject } from '../-guards/publicProject';
import { requirePermission } from '../-guards/requirePermission';
import { skillsGuardBeforeLoad } from '../-guards/skillsGuard';

/**
 * Guard tests (spec §9.3 R1; PERM-058/059/060; task RED/GREEN (b)(c)(d)(f)).
 *
 * `beforeLoad` guards throw a TanStack Router redirect `Response` (verified
 * against the installed `@tanstack/router-core@1.170.18`'s `redirect()`:
 * it builds a `Response` with `.options` carrying the navigation target,
 * and only throws it itself when `opts.throw` is set — every guard in this
 * unit calls `throw redirect({...})` explicitly, so the assertion here is
 * "catch the thrown Response, read `.options.to`").
 */

const VALID_TRIO = {
  VITE_SERVER_URL: 'https://elitea.example',
  VITE_BASE_URI: '/app/',
  VITE_PUBLIC_PROJECT_ID: '11',
} as const;

function stubValidConfig(): void {
  for (const [key, value] of Object.entries(VALID_TRIO)) {
    vi.stubEnv(key, value);
  }
}

function makeContext(user: AuthUser | undefined, selectedProjectId: string | undefined): { context: RouterContext } {
  const auth: AuthContext = {
    getUser: () => user,
    getSelectedProjectId: () => selectedProjectId,
  };
  return { context: { auth } };
}

function catchRedirectTarget(fn: () => void): string {
  try {
    fn();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response & { options?: { to?: string } };
    return response.options?.to ?? '';
  }
  throw new Error('expected a redirect to be thrown');
}

beforeEach(() => {
  resetConfigForTests();
  stubValidConfig();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe('guards > SkillsGuard', () => {
  it('RED/GREEN (b): redirects /skills/* to /chat when the selected project IS the public project', () => {
    const to = catchRedirectTarget(() => {
      skillsGuardBeforeLoad(makeContext(undefined, '11'));
    });
    expect(to).toBe('/chat');
  });

  it('does not redirect (passes through) for a non-public project', () => {
    expect(() => {
      skillsGuardBeforeLoad(makeContext(undefined, '42'));
    }).not.toThrow();
  });

  it('does not redirect when no project is selected yet (safe default, R2 stub context)', () => {
    expect(() => {
      skillsGuardBeforeLoad(makeContext(undefined, undefined));
    }).not.toThrow();
  });
});

describe('guards > IntegrationGuard', () => {
  // The guard's strict `=== false` check (faithfully ported from
  // IntegrationGuard.jsx:13, now read via F3's `getConfig().config
  // .allow_project_own_llms` — see integrationGuard.ts's header for the
  // retired `-guards/env.ts` workaround this replaced) can only be
  // satisfied by a REAL JS boolean, which — for `allow_project_own_llms` —
  // only source 1 (`window.elitea_ui_config`, the nginx entrypoint's raw JS
  // object literal) can carry; `import.meta.env`/`process.env` (what
  // `vi.stubEnv` writes) are always string-typed, exactly like real browser
  // env vars. `globalThis.elitea_ui_config` is therefore the correct way to
  // exercise the false branch here, not `vi.stubEnv`.
  afterEach(() => {
    delete (globalThis as { elitea_ui_config?: unknown }).elitea_ui_config;
  });

  it('RED/GREEN (c): redirects /settings/create-configuration to /settings/model-configuration when ALLOW_PROJECT_OWN_LLMS===false and the project is NOT public', () => {
    (globalThis as { elitea_ui_config?: unknown }).elitea_ui_config = { allow_project_own_llms: false };
    const to = catchRedirectTarget(() => {
      integrationGuardBeforeLoad(makeContext(undefined, '42'));
    });
    expect(to).toBe('/settings/model-configuration');
  });

  it('does not redirect when ALLOW_PROJECT_OWN_LLMS is not strictly false (old app: strict === false comparison)', () => {
    (globalThis as { elitea_ui_config?: unknown }).elitea_ui_config = { allow_project_own_llms: 'false' };
    expect(() => {
      integrationGuardBeforeLoad(makeContext(undefined, '42'));
    }).not.toThrow();
  });

  it('does not redirect on the public project even when ALLOW_PROJECT_OWN_LLMS===false', () => {
    (globalThis as { elitea_ui_config?: unknown }).elitea_ui_config = { allow_project_own_llms: false };
    expect(() => {
      integrationGuardBeforeLoad(makeContext(undefined, '11'));
    }).not.toThrow();
  });

  it('does not redirect when ALLOW_PROJECT_OWN_LLMS is unset (defaults true, old getEnvVar fallback)', () => {
    expect(() => {
      integrationGuardBeforeLoad(makeContext(undefined, '42'));
    }).not.toThrow();
  });

  it('falls back to true (does not redirect) when config has not resolved (defensive branch — unreachable in production, since app/App.tsx renders MissingEnvPage and returns before any router/beforeLoad mounts)', () => {
    vi.unstubAllEnvs();
    resetConfigForTests();
    expect(() => {
      integrationGuardBeforeLoad(makeContext(undefined, '42'));
    }).not.toThrow();
  });
});

describe('guards > IndexRoute', () => {
  it('RED/GREEN (d), branch 1: loading while user.id is unknown', () => {
    expect(decideIndexRoute(undefined)).toEqual({ kind: 'loading' });
    expect(decideIndexRoute({})).toEqual({ kind: 'loading' });
  });

  it('RED/GREEN (d), branch 2: redirects to /onboarding when the user has no personal_project_id', () => {
    expect(decideIndexRoute({ id: 'u1' })).toEqual({ kind: 'redirect', to: '/onboarding' });
  });

  it('RED/GREEN (d), branch 3: redirects to /chat once both id and personal_project_id are known', () => {
    expect(decideIndexRoute({ id: 'u1', personal_project_id: 'p1' })).toEqual({
      kind: 'redirect',
      to: '/chat',
    });
  });
});

describe('guards > requirePermission (P8 fix)', () => {
  it('RED/GREEN (f): blocks an unauthorized route — user lacks the required permission, real redirect fires', () => {
    const guard = requirePermission(['models.chat.folders.get'], '/onboarding');
    const to = catchRedirectTarget(() => {
      guard(makeContext({ id: 'u1', permissions: ['some.other.permission'] }, undefined));
    });
    expect(to).toBe('/onboarding');
  });

  it('allows through when the user HAS one of the required permissions', () => {
    const guard = requirePermission(['models.chat.folders.get'], '/onboarding');
    expect(() => {
      guard(makeContext({ id: 'u1', permissions: ['models.chat.folders.get'] }, undefined));
    }).not.toThrow();
  });

  it('does not block while permissions are not yet loaded (parity with old ProtectedRoute LoadingPage branch)', () => {
    const guard = requirePermission(['models.chat.folders.get'], '/onboarding');
    expect(() => {
      guard(makeContext({ id: 'u1' }, undefined));
    }).not.toThrow();
  });

  it('the artifacts permission guard redirects to /agents (spec §8.1 ROUTE-048 fallback)', () => {
    const guard = requirePermission(['configuration.artifacts.artifacts.view'], '/agents');
    const to = catchRedirectTarget(() => {
      guard(makeContext({ id: 'u1', permissions: [] }, undefined));
    });
    expect(to).toBe('/agents');
  });
});

describe('isPublicProject (branch coverage)', () => {
  it('returns false when config has not resolved (safe default)', () => {
    vi.unstubAllEnvs();
    resetConfigForTests();
    expect(isPublicProject('11')).toBe(false);
  });
});

// `allow_project_own_llms`'s C6 4-source fallback chain (window.elitea_ui_config
// -> import.meta.env -> globalThis.__ENV__ -> process.env) is unit F3's owned
// resolution mechanism and already has dedicated coverage for exactly this key
// in `shared/config/__tests__/get-config.test.ts` (see its "C6 resolution
// order for allow_project_own_llms" and "unparsed passthrough + getEnvVar(key,
// true) default" describe blocks) — no need to duplicate that here now that
// `-guards/env.ts`'s narrower, interim 3-of-4-source reimplementation has been
// retired in favour of reading `getConfig()` directly (integrationGuard.ts).
