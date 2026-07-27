import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > apps', () => {
  describeParamCases('apps', [{ key: 'view', valid: 'grid', malformed: 'circle' }]);
});
