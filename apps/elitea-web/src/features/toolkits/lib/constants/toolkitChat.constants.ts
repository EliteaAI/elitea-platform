/**
 * Ported verbatim from
 * `apps/elitea-ui/src/[fsd]/features/toolkits/lib/constants/toolkitChat.constants.js`
 * (4 lines, Wave-2 unit A4b). The two "modes" a toolkit test/index chat
 * panel can run in — driving `useToolkitChat`'s `isTestToolsMode`/
 * `isCreateIndexMode` branches (`../hooks/useToolkitChat.hooks.ts`).
 */
export const ToolkitChatModesEnum = {
  createIndex: 'create_index',
  testTools: 'test_tools',
} as const;
