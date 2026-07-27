import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';

import { handlers } from './msw/handlers/index';

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
});

afterAll(() => {
  server.close();
});
