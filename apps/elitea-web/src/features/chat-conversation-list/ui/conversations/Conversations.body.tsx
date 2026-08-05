import type { ReactNode, Ref } from 'react';

import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import type { Conversation } from '@/entities/conversation';
import { t } from '@/shared/i18n';

import type { DropAreaState } from '../../lib/hooks/useDragAndDrop';
import type { RenderConversationItem } from '../groups/DateGroup';
import { DroppableGroupedArea } from '../groups/DroppableGroupedArea';
import { GroupedConversations } from '../groups/GroupedConversations';
import { PinnedConversations } from './PinnedConversations';
import { UNGROUPED_DROPPABLE_ID } from './Conversations.styles';
import type { ConversationsDateGroup } from './Conversations.types';

/**
 * The scrollable list body (pinned folders, pinned conversations, unpinned
 * folders, date-grouped conversations, empty-search-results state —
 * `Conversations.jsx:665-745`), split out of `Conversations.tsx` purely to
 * keep that file under the §3.5 `max-lines`/`complexity` budgets, the same
 * "extract a render chunk into its own function" technique
 * `ConversationItem.row.tsx`'s own doc comment explains.
 */
export interface ConversationsBodyProps {
  readonly listRef: Ref<HTMLDivElement>;
  readonly collapsed: boolean;
  readonly isSmallWindow: boolean;
  readonly isLoadConversations: boolean;
  readonly renderPinnedFolders: () => ReactNode;
  readonly renderUnpinnedFolders: () => ReactNode;
  readonly pinnedConversations: readonly Conversation[];
  readonly renderConversationItem: RenderConversationItem;
  readonly dateGroups: readonly ConversationsDateGroup[];
  readonly totalConversationsAmount: number;
  readonly onLoadMoreInGroup: (groupName: string) => void;
  readonly loadingGroups: ReadonlySet<string>;
  readonly enableDragAndDrop: boolean;
  readonly getDropAreaState: (dropAreaId: string) => DropAreaState;
  readonly selectedConversationId: string | undefined;
  readonly isSearchMode: boolean;
  readonly searchQuery: string;
  readonly isEditingCanvas: boolean;
  readonly showEmptyState: boolean;
}

export function ConversationsBody(props: ConversationsBodyProps): ReactNode {
  const {
    listRef,
    collapsed,
    isSmallWindow,
    isLoadConversations,
    renderPinnedFolders,
    renderUnpinnedFolders,
    pinnedConversations,
    renderConversationItem,
    dateGroups,
    totalConversationsAmount,
    onLoadMoreInGroup,
    loadingGroups,
    enableDragAndDrop,
    getDropAreaState,
    selectedConversationId,
    isSearchMode,
    searchQuery,
    isEditingCanvas,
    showEmptyState,
  } = props;
  const theme = useTheme();

  if (isLoadConversations) {
    return (
      <>
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton
            key={index}
            data-testid="conversations-loading-skeleton"
            animation="wave"
            variant="rectangular"
            width="100%"
            height="74px"
            sx={{ marginTop: theme.spacing(1) }}
          />
        ))}
      </>
    );
  }

  const collapsedHidden = collapsed && !isSmallWindow;

  return (
    <Box
      ref={listRef}
      sx={{ marginTop: theme.spacing(1), display: collapsedHidden ? 'none' : 'flex', flexDirection: 'column', overflowY: 'scroll', height: 'calc(100% - 40px)', paddingBottom: theme.spacing(4) }}
    >
      {renderPinnedFolders()}

      <PinnedConversations
        pinnedConversations={pinnedConversations}
        renderConversationItem={renderConversationItem}
      />

      {renderUnpinnedFolders()}

      <DroppableGroupedArea
        isDropDisabled={!enableDragAndDrop || isEditingCanvas}
        {...getDropAreaState(UNGROUPED_DROPPABLE_ID)}
      >
        <GroupedConversations
          dateGroups={dateGroups}
          totalConversationsAmount={totalConversationsAmount}
          renderConversationItem={renderConversationItem}
          onLoadMoreInGroup={onLoadMoreInGroup}
          loadingGroups={loadingGroups}
          enableDragAndDrop={enableDragAndDrop}
          getDropAreaState={getDropAreaState}
          selectedConversationId={selectedConversationId}
          isSearchMode={isSearchMode}
          searchQuery={searchQuery}
        />
      </DroppableGroupedArea>

      {showEmptyState && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: theme.spacing(4, 2), textAlign: 'center' }}>
          <Typography
            variant="bodyMedium"
            color="text.button.disabled"
            sx={{ marginBottom: theme.spacing(1) }}
          >
            {t('features.chatConversationList.conversations.noResultsTitle', 'No conversations found')}
          </Typography>
          <Typography
            variant="bodySmall"
            color="text.button.disabled"
          >
            {t('features.chatConversationList.conversations.noResultsHint', 'Try adjusting your search terms')}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
