/**
 * ROUTE-008 `/chat/:conversationId` -> `ChatWrapper` (spec §8.1, same
 * component + same permission requirement as ROUTE-007; see `chat.tsx`'s
 * header for the search-param inheritance note). `beforeLoad` re-applies
 * `requireChatPermission` so a deep link straight to a conversation is
 * gated exactly like `/chat` itself (TanStack does not re-run an
 * ancestor's `beforeLoad` for the parent's OWN redirect decision on a
 * deeper URL match implicitly — it runs every matched level's own
 * `beforeLoad`, so this is required, not redundant with an inherited
 * effect).
 */
import { createFileRoute } from '@tanstack/react-router';

import { requireChatPermission } from '../-guards/requirePermission';
import { RouteError, RoutePending } from '../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/chat/$conversationId')({
  beforeLoad: requireChatPermission,
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => null,
});
