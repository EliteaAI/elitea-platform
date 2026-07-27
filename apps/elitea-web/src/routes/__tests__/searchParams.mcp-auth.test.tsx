import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > mcp-auth', () => {
  describeParamCases('mcp-auth', [
    { key: 'code', valid: 'abc', malformed: { a: 1 } },
    { key: 'error', valid: 'access_denied', malformed: { a: 1 } },
    { key: 'error_description', valid: 'denied', malformed: { a: 1 } },
    { key: 'state', valid: 'xyz', malformed: { a: 1 } },
  ]);
});
