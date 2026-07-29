import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';

import type { Conversation } from '@/entities/conversation';
import { t } from '@/shared/i18n';

import type { FolderListItem } from '../../lib/hooks/conversationListState.types';
import type { RenderConversationItem } from '../groups/DateGroup';
import { LoadMoreSentinel } from '../groups/LoadMoreSentinel';

const LOADING_SKELETON_COUNT = 3;

export interface FolderAccordionItemProps {
  readonly folder: FolderListItem;
  readonly renderConversationItem: RenderConversationItem;
  readonly onLoadMore?: (() => void) | undefined;
  readonly isLoadingMore?: boolean | undefined;
}

/**
 * `folder.conversations.sort(...)`, ported verbatim from
 * `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/ui/folders/
 * FolderAccordionItem.jsx:441-450` — client-side, descending by
 * `updated_at`/`created_at`, independent of whatever order `folder.
 * conversations` already arrived in from the parent. This is real baseline
 * behaviour, not a bug: a folder's conversations can be reordered by other
 * state updates (drag-and-drop, an optimistic move) without this component
 * re-sorting, so it re-derives the display order itself on every render
 * instead of trusting the incoming array order.
 */
function sortFolderConversations(conversations: readonly Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    const dateA = new Date(a.updatedAt ?? a.createdAt ?? 0);
    const dateB = new Date(b.updatedAt ?? b.createdAt ?? 0);
    return dateB.getTime() - dateA.getTime();
  });
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/ui/
 * folders/FolderAccordionItem.jsx` (unit C2/folders) — a single folder's
 * conversation list body, rendered as `FolderAccordion`'s `content` slot.
 *
 * `hasMore`/`totalAvailableCount` load-more wiring reuses the sibling
 * `ui/groups` cluster's `LoadMoreSentinel` (built concurrently, same unit)
 * rather than a local duplicate — that component's own module doc already
 * anticipates exactly this call site (`totalAvailableCount={folder.total ||
 * 0}`). See `LoadMoreSentinel.tsx`'s doc comment for why the baseline's own
 * `ListInfiniteMoreLoader` extra dedupe bookkeeping is not reproduced.
 */
export function FolderAccordionItem({ folder, renderConversationItem, onLoadMore, isLoadingMore = false }: FolderAccordionItemProps): ReactNode {
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  const handleItemHover = useCallback((itemId: string, isHovered: boolean): void => {
    setHoveredItemId(isHovered ? itemId : null);
  }, []);

  const sortedConversations = useMemo(() => sortFolderConversations(folder.conversations), [folder.conversations]);

  return (
    <Box sx={(theme: Theme) => containerSx(theme, sortedConversations.length === 0)}>
      {sortedConversations.length > 0 ? (
        <>
          {sortedConversations.map((conversation, index) => {
            const nextConversation = sortedConversations[index + 1];
            const isNextItemHovered = nextConversation?.id === hoveredItemId;
            return renderConversationItem(conversation, handleItemHover, isNextItemHovered);
          })}

          {isLoadingMore &&
            Array.from({ length: LOADING_SKELETON_COUNT }).map((_, index) => (
              <Skeleton
                key={`skeleton-${index}`}
                data-testid="folder-accordion-item-skeleton"
                animation="wave"
                variant="rectangular"
                width="100%"
                height="2.5rem"
                sx={skeletonSx}
              />
            ))}

          <LoadMoreSentinel
            listCurrentSize={sortedConversations.length}
            totalAvailableCount={folder.total ?? 0}
            onLoadMore={onLoadMore ?? noop}
            isLoading={isLoadingMore}
          />
        </>
      ) : (
        <Typography
          variant="bodyMedium"
          sx={emptyStateSx}
        >
          {t('features.chatConversationList.folderAccordionItem.empty', 'No conversations added')}
        </Typography>
      )}
    </Box>
  );
}

function noop(): void {}

function containerSx(theme: Theme, isEmpty: boolean) {
  return {
    borderBottom: isEmpty ? `0.0625rem solid ${theme.vars.palette.background.button.drawerMenu.selected}` : undefined,
    color: theme.vars.palette.text.tagChip.disabled,
  };
}

const skeletonSx = (theme: Theme) => ({ borderRadius: theme.vars.shape.radiusSm, marginBottom: theme.spacing(0.25) });

const emptyStateSx = (theme: Theme) => ({ lineHeight: '3rem', marginLeft: theme.spacing(1) });
