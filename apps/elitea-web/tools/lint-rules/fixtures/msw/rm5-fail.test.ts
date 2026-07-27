import { expect, it } from 'vitest';

// R-M5 RED: no handler covers this URL. With onUnhandledRequest:'error'
// (src/test/setup.ts) the request is rejected and this test MUST fail.
it('unmocked request would pass without the R-M5 fence', async () => {
  const response = await fetch('http://127.0.0.1:9797/api/v2/unmocked');
  expect(response.ok).toBe(true);
});
