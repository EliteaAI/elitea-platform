import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > agents', () => {
  describeParamCases('agents', [
    { key: 'destTab', valid: 'History', malformed: { a: 1 } },
    { key: 'edited_participant_id', valid: 'p-123', malformed: { a: 1 } },
    { key: 'isFromCreation', valid: '1', malformed: 'yes' },
    { key: 'mcp', valid: 'mcp-1', malformed: { a: 1 } },
    { key: 'newToolkitId', valid: 'tk-1', malformed: { a: 1 } },
    { key: 'return_url', valid: '/agents/my', malformed: { a: 1 } },
    { key: 'sort_by', valid: 'name', malformed: { a: 1 } },
    { key: 'sort_order', valid: 'asc', malformed: 'sideways' },
    { key: 'source_application_id', valid: 'app-1', malformed: { a: 1 } },
    { key: 'viewMode', valid: 'owner', malformed: 'admin' },
  ]);
});
