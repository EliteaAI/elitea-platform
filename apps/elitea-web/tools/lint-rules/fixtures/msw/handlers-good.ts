import { http, HttpResponse } from 'msw';

import usersFixture from './users.list.200.json';

// R-M2 GREEN: body derives from a Channel-B fixture file.
export const handlers = [
  http.get('/api/v2/users', () => HttpResponse.json(usersFixture.body)),
];
