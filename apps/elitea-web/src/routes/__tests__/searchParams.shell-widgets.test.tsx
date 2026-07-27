import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > shell-widgets', () => {
  describeParamCases('shell-widgets', [{ key: 'page_size', valid: 20, malformed: -5 }]);
});
