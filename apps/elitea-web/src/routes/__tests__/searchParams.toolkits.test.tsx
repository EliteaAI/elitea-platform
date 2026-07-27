import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > toolkits', () => {
  describeParamCases('toolkits', [
    { key: 'destTab', valid: 'History', malformed: { a: 1 } },
    { key: 'edited_participant_id', valid: 'p-1', malformed: { a: 1 } },
    { key: 'forceCustom', valid: '1', malformed: 'nope' },
    { key: 'name', valid: 'My Toolkit', malformed: { a: 1 } },
    { key: 'newToolkitId', valid: 'tk-1', malformed: { a: 1 } },
    { key: 'return_url', valid: '/toolkits/all', malformed: { a: 1 } },
    { key: 'source_application_id', valid: 'app-1', malformed: { a: 1 } },
  ]);
});
