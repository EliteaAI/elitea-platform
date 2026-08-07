import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';

// [S1] `toBeInTheDocument`/`toHaveTextContent`/etc. — every `shared/ui`
// component test in this unit asserts against the rendered DOM via these
// matchers. `@testing-library/jest-dom/vitest` self-registers with vitest's
// `expect` on import (no `expect.extend` call needed — verified against the
// installed package's `./vitest` export, `@testing-library/jest-dom@6.9.1`).
// Global, additive, and required by ANY future DOM-assertion test in the
// tree, not just this unit's — so it belongs in the shared bootstrap F4
// authored rather than being re-imported per test file.
import '@testing-library/jest-dom/vitest';

// [M1 carry-forward] Node 24 ships an experimental `localStorage` global that
// shadows jsdom's and resolves to `undefined` without `--localstorage-file`,
// so `window.localStorage` is undefined in the `node` project and any
// component reading it during an effect throws (`<Sidebar>`, `<AppShell>`).
// Installed here — not per test file — so every unit inherits it; see the
// shim's own module comment for the full diagnosis. No-ops when the
// environment already provides working storage.
import { installWebStorageShim } from '@/shared/lib/webstorage.testshim';

import { handlers } from './msw/handlers/index';

const shimmedStorages = installWebStorageShim();

/**
 * Global test bootstrap for the `node` (jsdom) vitest project (spec §6.3).
 *
 * Mocks stop at the network boundary (§6.2): the ONLY substitutions a test
 * may make are this MSW server and the socket in-memory double (unit S5).
 *
 * R-M5 (§6.5): `onUnhandledRequest: 'error'` — a request no handler covers
 * fails the test instead of silently hitting the network. Proven by the
 * msw fixture pair in scripts/check-gates-selftest.mjs.
 */
export const server = setupServer(...handlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  // Removes runtime handlers added via server.use() so network behaviour
  // never leaks between tests.
  server.resetHandlers();

  // The shim above installs ONE storage instance for the whole worker, where
  // a working jsdom would hand each test file its own `window`. Without this
  // reset, storage written by one test is visible to every later test in the
  // same worker — an isolation leak that shows up as tests passing alone and
  // failing in-suite. Clearing here restores per-test isolation.
  for (const name of shimmedStorages) {
    (globalThis as unknown as Record<string, Storage | undefined>)[name]?.clear();
  }
});

afterAll(() => {
  server.close();
});
