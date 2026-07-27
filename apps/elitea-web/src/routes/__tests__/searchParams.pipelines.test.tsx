import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > pipelines', () => {
  describeParamCases('pipelines', [
    { key: 'isFromCreation', valid: '1', malformed: 'yes' },
    { key: 'sort_by', valid: 'name', malformed: { a: 1 } },
    { key: 'sort_order', valid: 'desc', malformed: 'sideways' },
  ]);
});
