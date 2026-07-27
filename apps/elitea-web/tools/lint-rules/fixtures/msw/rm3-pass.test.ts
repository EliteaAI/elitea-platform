import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { z } from 'zod';

import { registerValidatedHandlers } from '../../../../src/test/msw/register';

// R-M3 GREEN: a schema-conforming fixture registers cleanly.
it('schema-conforming fixture registers', () => {
  const handlers = registerValidatedHandlers([
    {
      id: 'users.get',
      handler: http.get('/api/v2/users/1', () => HttpResponse.json({ id: 1, name: 'Ada' })),
      schema: z.object({ id: z.number(), name: z.string() }),
      fixture: { recordedAt: new Date().toISOString(), body: { id: 1, name: 'Ada' } },
    },
  ]);
  expect(handlers).toHaveLength(1);
});
