import { useCallback, useMemo, useState } from 'react';

import { fromUnixTime } from 'date-fns';

import { ROLES, WELCOME_MESSAGE_ID } from '@/shared/lib/enums';
import type { Message } from '@/entities/message';

import { useIndexHistoryConversationDetailsQuery } from '../../api/indexesApi';
import type { ConversationDetailsWire } from '../../api/indexesApi';
import { useIndexesStore } from '../../model/indexesStore';
import { IndexStatuses } from '../constants/indexDetails.constants';
import { convertConversationToChatHistory } from '../helpers/conversationHistory.local';
import { useSelectedProjectId } from './useSelectedProjectId';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/lib/hooks/
 * useIndexHistory.hooks.js` (unit A4a). Drives the index-details "History"
 * tab and the in-progress-reindex-recovery flow.
 *
 * Two real deviations from the baseline, both disclosed:
 *
 *  - `RunHistoryApi.useLazyGetRunHistoryDetailsQuery` (Redux/RTK Query,
 *    lazy) becomes `useIndexHistoryConversationDetailsQuery` (TanStack
 *    Query) from this sub-unit's own `../../api/indexesApi.ts` — see that
 *    file's own doc comment for why (`entities/run-history` does not exist
 *    in this app). TanStack Query has no "lazy" query primitive the way RTK
 *    Query does; the `enabled` flag this hook computes below is the direct
 *    substitute — the query only actually fires once `enabled` is true,
 *    same effective behaviour as the baseline's imperative
 *    `fetchConversationDetails(...)` calls.
 *  - `ToolkitsHelpers.prettifyToolkitConversation` (baseline:
 *    `features/toolkits/lib/helpers`, applied to the non-mock branch) is
 *    NOT applied here. It operates on the baseline's snake_case
 *    `message_items` field; `entities/message`'s port of the underlying
 *    normalizer deliberately renamed that to camelCase `messageItems` (a
 *    disclosed, already-accepted rename — see `entities/message/model/
 *    types.ts`'s `MessageBase`). Calling the old function against the new
 *    shape would silently no-op (reading `undefined.map`) or throw. It is a
 *    cosmetic markdown-cleanup pass over toolkit test-output message
 *    content, not core data flow, so this hook returns the normalized
 *    messages unprettified rather than risk either failure mode.
 *
 * `selectHistoryItem`/`selectedHistoryItem` now come from
 * `../../model/indexesStore.ts` (zustand) instead of `useSelector` — see
 * that file's own doc comment.
 */

export interface ProgressHistoryOptions {
  readonly shouldRecover?: boolean;
  readonly conversationId?: string;
}

export interface UseIndexHistoryResult {
  readonly isHistoryMode: boolean;
  readonly isHistoryLoading: boolean;
  readonly historyMessages: readonly Message[];
  readonly historyConversation: ConversationDetailsWire | null;
  readonly needGenerateProgressingIndexHistory: boolean;
  readonly conversationDetails: ConversationDetailsWire | undefined;
  readonly setProgressingIndexHistoryRecovered: (value: boolean) => void;
}

function getHistoryMockMessage(
  showMockMessage: boolean,
  indexHistoryItem: Record<string, unknown> | null,
): Message[] {
  if (!showMockMessage || !indexHistoryItem) return [];

  const state = indexHistoryItem['state'];
  const isFailed = state === IndexStatuses.fail;
  const isPartlyOk = state === IndexStatuses.partlyOk;

  const getFailedTrace = (): unknown =>
    indexHistoryItem['error'] ?? 'The system encountered an issue and was unable to complete the scheduled reindexing operation';

  const executionSummary = isFailed
    ? 'The system encountered an issue and was unable to complete the scheduled reindexing operation'
    : isPartlyOk
      ? 'Partially indexed by schedule'
      : 'Successfully reindexed by schedule';

  const content = `{ "reindexed": ${String(indexHistoryItem['updated'])}, "indexed": ${String(indexHistoryItem['indexed'])} }`;
  const updatedOn = indexHistoryItem['updated_on'] as number | undefined;

  return [
    {
      id: WELCOME_MESSAGE_ID,
      role: ROLES.Assistant,
      content: isFailed ? executionSummary : `${executionSummary}\n\n\`\`\`json\n${content}\n\`\`\``,
      ...(updatedOn !== undefined ? { createdAt: new Date(fromUnixTime(updatedOn)).toISOString() } : {}),
      ...(isFailed ? { exception: getFailedTrace() } : {}),
    },
  ];
}

export function useIndexHistory(progressHistoryOptions: ProgressHistoryOptions | null = null): UseIndexHistoryResult {
  const projectId = useSelectedProjectId();

  const indexHistoryItem = useIndexesStore((state) => state.selectedHistoryItem);
  const isHistoryMode = Boolean(indexHistoryItem);

  const [progressingIndexHistoryRecovered, setProgressingIndexHistoryRecovered] = useState(false);

  const allowProgressingIndexHistoryRecovering =
    Boolean(progressHistoryOptions?.shouldRecover) && !progressingIndexHistoryRecovered;

  const historyConversationId = indexHistoryItem?.['conversation_id'] as string | null | undefined;

  const activeConversationId = allowProgressingIndexHistoryRecovering
    ? progressHistoryOptions?.conversationId
    : isHistoryMode && historyConversationId
      ? historyConversationId
      : undefined;

  const {
    data: conversationDetails,
    isFetching: isConversationDetailsFetching,
  } = useIndexHistoryConversationDetailsQuery(
    { projectId, conversationId: activeConversationId },
    { enabled: activeConversationId !== undefined },
  );

  const getHistoryMockMessageMemo = useCallback(
    (showMockMessage: boolean) => getHistoryMockMessage(showMockMessage, indexHistoryItem),
    [indexHistoryItem],
  );

  const { isHistoryLoading, historyMessages, historyConversation } = useMemo(() => {
    const showMockMessage = isHistoryMode && (historyConversationId === null || Boolean(indexHistoryItem?.['error']));

    const conversation = isHistoryMode ? (conversationDetails ?? null) : null;

    const currentConversationMessages = conversation
      ? convertConversationToChatHistory(conversation)
      : getHistoryMockMessageMemo(showMockMessage);

    return {
      isHistoryLoading: isConversationDetailsFetching,
      historyMessages: currentConversationMessages,
      historyConversation: conversation,
    };
  }, [isHistoryMode, isConversationDetailsFetching, indexHistoryItem, historyConversationId, conversationDetails, getHistoryMockMessageMemo]);

  const needGenerateProgressingIndexHistory =
    allowProgressingIndexHistoryRecovering &&
    conversationDetails !== undefined &&
    !isConversationDetailsFetching &&
    !progressingIndexHistoryRecovered;

  return {
    isHistoryMode,
    isHistoryLoading,
    historyMessages,
    historyConversation,
    needGenerateProgressingIndexHistory,
    conversationDetails,
    setProgressingIndexHistoryRecovered,
  };
}
