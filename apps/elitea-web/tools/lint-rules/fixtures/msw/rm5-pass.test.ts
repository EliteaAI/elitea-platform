import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';

import { server } from '../../../../src/test/setup';

// R-M5 GREEN: the same request with a registered handler passes.
it('handled request passes under onUnhandledRequest:error', async () => {
  server.use(http.get('http://127.0.0.1:9797/api/v2/unmocked', () => HttpResponse.json({ ok: true })));
  const response = await fetch('http://127.0.0.1:9797/api/v2/unmocked');
  expect(response.ok).toBe(true);
});
