/**
 * Real data composition for the `/chat` page — the piece `features/chat-
 * messages/index.ts` and `processes/chat/index.ts` both describe as
 * pending ("only real consumer is a not-yet-built app/-level composition
 * root that wires an actual chat page"). Resolves project/user/
 * conversation/active-participant and maps them into the shape `ChatBox`
 * (the C6 composition root) expects.
 *
 * DISCLOSED GAP — `projectId` has no fully-wired source yet. Three
 * candidate sources exist in this codebase today; only the third is live:
 *  - `src/app/router-context.ts`'s `AuthContext.getSelectedProjectId()` is
 *    a stub (`() => undefined`) pending unit R2 — confirmed via
 *    `src/app/App.tsx`'s `<RouterProvider router={router} />`, which never
 *    overrides the router's context with a real implementation.
 *  - `widgets/app-shell`'s `useSelectedProject()` is real and working, but
 *    is only ever populated by a user picking a project through
 *    `AppShell` (unit S1), which no route mounts yet.
 *  - The old app's own fallback — "selected project id, falling back to
 *    `personal_project_id`" (`router-context.ts`'s own doc comment
 *    records this as the old app's `useSelectedProjectId()` behavior) —
 *    IS fully available today via `useGetCurrentAuthor()`, so that
 *    fallback is what this hook actually uses. Once AppShell/S1 lands, a
 *    real `useSelectedProject().project` selection correctly takes
 *    priority over this fallback below, matching old-app precedence.
 */
import { useMemo } from 'react';

import { conversationApi } from '@/entities/conversation';
import type { MessageGroupWire } from '@/entities/message';
import type { SocialAuthorProfile } from '@/shared/api/generated/model';
import { useGetCurrentAuthor } from '@/shared/api/generated/social/social';
import { useSelectedProject } from '@/widgets/app-shell';
import type { ChatBoxProps } from '@/widgets/chat-box';

const MESSAGE_PAGE_SIZE = 50;

export interface UseChatPageDataParams {
  readonly conversationId: string | undefined;
}

export interface UseChatPageDataResult {
  readonly projectId: string | undefined;
  readonly user: { readonly id: string; readonly name: string; readonly avatar: string } | undefined;
  readonly activeConversation: ChatBoxProps['activeConversation'];
  readonly isLoadingConversation: boolean;
}

/**
 * `getCurrentAuthorResponse`'s `.data` is a `SocialAuthorProfile |
 * N401Response` union (discriminated by `.status`), but `eliteaFetch`
 * throws on any non-2xx response rather than resolving with the error
 * variant (§3.6 unwrap contract) — the 401 branch is declared but
 * unreachable at this read site. Same established precedent as
 * `features/chat-conversation-list/ui/folders/FolderItem.tsx`'s own
 * `useCurrentUserId`.
 */
function currentAuthorOf(data: unknown): SocialAuthorProfile | undefined {
  return (data as { readonly data?: SocialAuthorProfile } | undefined)?.data;
}

/** Maps the REST conversation-details + message-list queries into `ChatBox`'s `activeConversation` prop shape. */
function useActiveConversation(projectId: string | undefined, conversationId: string | undefined): { readonly activeConversation: ChatBoxProps['activeConversation']; readonly isLoading: boolean } {
  const enabled = projectId !== undefined && conversationId !== undefined;
  const detailsQuery = conversationApi.useDetails({ projectId: projectId ?? '', id: conversationId ?? '' }, { enabled });
  const messageListQuery = conversationApi.useMessageList(
    { projectId: projectId ?? '', conversationId: conversationId ?? '', page: 0, pageSize: MESSAGE_PAGE_SIZE, params: { sort_order: 'asc' } },
    { enabled },
  );

  const activeConversation = useMemo<ChatBoxProps['activeConversation']>(() => {
    if (!conversationId) return { isNew: true };
    if (!detailsQuery.data) return undefined;
    const response = messageListQuery.data;
    const rows = response ? ('rows' in response ? response.rows : response) : [];
    return {
      id: detailsQuery.data.id,
      ...(detailsQuery.data.uuid !== undefined ? { uuid: detailsQuery.data.uuid } : {}),
      name: detailsQuery.data.name,
      participants: detailsQuery.data.participants ? [...detailsQuery.data.participants] : [],
      message_groups: rows as unknown as MessageGroupWire[],
    };
  }, [conversationId, detailsQuery.data, messageListQuery.data]);

  return { activeConversation, isLoading: enabled && (detailsQuery.isLoading || messageListQuery.isLoading) };
}

/** @public Composes real project/user/conversation data for the `/chat` page. */
export function useChatPageData({ conversationId }: UseChatPageDataParams): UseChatPageDataResult {
  const { project } = useSelectedProject();
  const authorQuery = useGetCurrentAuthor();
  const author = currentAuthorOf(authorQuery.data);

  const projectId = project?.id ?? author?.personal_project_id;
  const { activeConversation, isLoading } = useActiveConversation(projectId, conversationId);

  const user = author ? { id: author.id, name: author.name, avatar: author.avatar } : undefined;

  return { projectId, user, activeConversation, isLoadingConversation: isLoading };
}
