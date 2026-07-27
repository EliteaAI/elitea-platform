import { describe } from 'vitest';

import { describeParamCases } from './searchParamsTestKit';

describe('search-params > chat', () => {
  describeParamCases('chat', [
    { key: 'conversation', valid: 'conv-1', malformed: { a: 1 } },
    { key: 'edited_participant_id', valid: 'p-1', malformed: { a: 1 } },
    { key: 'message_id', valid: 'msg-1', malformed: { a: 1 } },
    { key: 'name', valid: 'My Folder', malformed: { a: 1 } },
  ]);
});
