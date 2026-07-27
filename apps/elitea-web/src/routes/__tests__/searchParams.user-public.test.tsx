import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > user-public', () => {
  describeParamCases('user-public', [{ key: 'statuses', valid: ['active'] }]);
});
