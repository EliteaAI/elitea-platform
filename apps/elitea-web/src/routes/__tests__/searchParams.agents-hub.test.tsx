import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > agents-hub', () => {
  describeParamCases('agents-hub', [{ key: 'agentId', valid: 'a-1', malformed: { a: 1 } }]);
});
