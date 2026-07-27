import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > settings-users', () => {
  describeParamCases('settings-users', [{ key: 'inviteUsers', valid: '1', malformed: 'open' }]);
});
