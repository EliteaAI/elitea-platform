import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { z } from 'zod';

import { registerValidatedHandlers } from '../../../../src/test/msw/register';

// R-M3 RED: the fixture body violates its zod schema. Registration must
// throw at boot, so this "lazy path" test MUST fail.
it('schema-violating fixture would register without the R-M3 fence', () => {
  const handlers = registerValidatedHandlers([
    {
      id: 'users.get',
      handler: http.get('/api/v2/users/1', () => HttpResponse.json({ id: 'wrong' })),
      schema: z.object({ id: z.number(), name: z.string() }),
      fixture: { recordedAt: new Date().toISOString(), body: { id: 'wrong' } },
    },
  ]);
  expect(handlers).toHaveLength(1);
});
