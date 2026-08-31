import { describe, expect, it } from 'vitest';

import * as entity from './index';

/**
 * Pins the slice's RUNTIME public surface (spec §3.3: index.ts is the only
 * file other slices may import). `export type` interfaces are erased by
 * `verbatimModuleSyntax` and never appear on the runtime namespace object,
 * so this list is deliberately the value-export subset only — see the
 * source files for the full (type + value) surface. Precedent:
 * src/shared/brand/index.test.ts. Also gives knip a live import edge into
 * this slice ahead of its Wave-2 consumers.
 */
/*
 * CURATED, not a barrel (§3.3, budget 20). Four runtime symbols left when the
 * share-by-link hooks joined: `createDraftConversation`, `isPinnedConversation`,
 * `sortConversations`, `useUpdateConversationTimestamp` and
 * `useHighlightUserMessage` were exported here but imported from here by
 * NOTHING — every consumer reaches them inside the slice. Re-exporting them
 * bought no caller anything and spent the budget that the share surface needs,
 * so they came off rather than the budget being waived.
 *
 * The share hooks are on the barrel because `features/chat-conversation-list`
 * owns that affordance and `no-deep-slice-import-cross-slice` forbids it
 * reaching past this file — a deep import would bind that feature to this
 * slice's layout.
 */
const PUBLIC_SURFACE = [
  'SHARED_CHAT_LINKS_QUERY_KEY',
  'hasPlaybackConversation',
  'conversationApi',
  'contextManagementApi',
  'useChatSessionStore',
  'useConversationLifecycle',
  'conversationNavigation',
  'useChatStreaming',
  'useAttachmentState',
  'useUploadAttachments',
  'useShareLinksQuery',
  'useCreateShareLinkMutation',
  'useRevokeShareLinkMutation',
  'chatHelpers',
  'newConversationHelpers',
] as const;

describe('entities/conversation public surface', () => {
  it('exports exactly the documented runtime set', () => {
    expect(Object.keys(entity).sort()).toEqual([...PUBLIC_SURFACE].sort());
  });
});
