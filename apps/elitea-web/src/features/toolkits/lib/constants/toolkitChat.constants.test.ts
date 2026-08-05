import { describe, expect, it } from 'vitest';

import { ToolkitChatModesEnum } from './toolkitChat.constants';

describe('ToolkitChatModesEnum', () => {
  it('carries the two baseline mode values verbatim', () => {
    expect(ToolkitChatModesEnum).toEqual({ createIndex: 'create_index', testTools: 'test_tools' });
  });
});
