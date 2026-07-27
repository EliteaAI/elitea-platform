import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > indexes', () => {
  describeParamCases('indexes', [{ key: 'index_name', valid: 'idx-1', malformed: { a: 1 } }]);
});
