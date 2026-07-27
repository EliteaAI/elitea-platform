import { http, HttpResponse } from 'msw';

// R-M2 RED: hand-written inline body.
export const handlers = [
  http.get('/api/v2/users', () => HttpResponse.json({ id: 1, name: 'inline literal' })),
];
