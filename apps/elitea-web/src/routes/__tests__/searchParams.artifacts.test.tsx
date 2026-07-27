import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > artifacts', () => {
  describeParamCases('artifacts', [
    { key: 'bucket', valid: 'my-bucket', malformed: { a: 1 } },
    { key: 'file', valid: 'file.txt', malformed: { a: 1 } },
    { key: 'folder', valid: '/docs', malformed: { a: 1 } },
    { key: 'shared_bucket', valid: 'shared-1', malformed: { a: 1 } },
  ]);
});
