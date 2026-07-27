import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > auth-callback', () => {
  describeParamCases('auth-callback', [{ key: 'auth_state', valid: 'abc123', malformed: { a: 1 } }]);
});
