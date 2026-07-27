import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > settings', () => {
  describeParamCases('settings', [{ key: 'createSecret', valid: '1', malformed: 'open' }]);
});
