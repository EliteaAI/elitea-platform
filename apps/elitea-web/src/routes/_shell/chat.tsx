/**
 * ROUTE-007 `/chat` -> `ChatWrapper` (spec §8.1: "requires
 * models.chat.folders.get; otherwise -> /onboarding" — the P8 fix, task
 * item 4). Query params PARAM-029/031/033/035/077 (`/chat`) — declared
 * here; `/chat/:conversationId` (PARAM-030/032/034/036/078) inherits them
 * (TanStack Router composes a child's search type/validation from every
 * ancestor's `validateSearch` — verified against the installed
 * `@tanstack/router-core`'s `accumulatedSearch` merge in `router.js`), so
 * `chat.$conversationId.tsx` does not re-declare the same 5 keys.
 *
 * Old app: `{ path: Chat, element: <ChatWrapper/> }` and
 * `{ path: ChatConversation, element: <ChatWrapper/> }` render the SAME
 * component (`ChatWrapper` reads the optional `:conversationId` itself) —
 * not two exclusive screens, so this always renders its own content plus
 * `<Outlet/>` (no `ExclusiveOutlet` needed, unlike the tab-list/detail
 * families below).
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { requireChatPermission } from '../-guards/requirePermission';
import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { RouteShell } from '../-ui/RouteShell';
import { pickParams } from '../-search/params';

export const Route = createFileRoute('/_shell/chat')({
  validateSearch: pickParams('conversation', 'edited_participant_id', 'message_id', 'name', 'shared_chat'),
  beforeLoad: requireChatPermission,
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ChatWrapperShell,
});

function ChatWrapperShell() {
  return (
    <>
      <RouteShell routeId="chat" fallback="Chat" />
      <Outlet />
    </>
  );
}
