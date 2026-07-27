import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > credentials', () => {
  describeParamCases('credentials', [
    { key: 'forceCustom', valid: '1', malformed: 'nope' },
    { key: 'from', valid: '/credentials', malformed: { a: 1 } },
    { key: 'prefill_id', valid: 'cred-1', malformed: { a: 1 } },
    { key: 'prefill_name', valid: 'My Cred', malformed: { a: 1 } },
    { key: 'section', valid: 'auth', malformed: { a: 1 } },
  ]);
});
