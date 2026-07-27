import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > skills', () => {
  describeParamCases('skills', [
    { key: 'newSkillId', valid: 'skill-1', malformed: { a: 1 } },
    { key: 'return_url', valid: '/skills/all', malformed: { a: 1 } },
    { key: 'source_application_id', valid: 'app-1', malformed: { a: 1 } },
  ]);
});
