// @ts-nocheck
/**
 * Local active participant hook — ported from `useLocalActiveParticipant.js`.
 * Manages `localStorage` state for the active participant in each conversation.
 * Uses `ActiveConversationParticipantKey` from shared constants.
 */
import { useCallback } from 'react';

import { useSelectedProjectId } from '../../api/useSelectedProjectId';

/**
 * Old-app's actual key value (`common/constants.js:983`:
 * `export const ActiveConversationParticipantKey = 'ActiveConversationParticipantKey';`)
 * — NOT a new, differently-named literal. Reusing the same key lets data
 * written by the old app (e.g. during a parallel old/new rollout on the same
 * origin) still be read by this port.
 */
const ACTIVE_CONVERSATION_PARTICIPANT_KEY = 'ActiveConversationParticipantKey';

interface ParticipantEntry {
  cid: string;
  pid: string;
}

interface ProjectParticipantMap {
  [projectId: string]: ParticipantEntry[];
}

/**
 * Manages localStorage-backed active participant state.
 * Ported from `useLocalActiveParticipant.js`.
 */
export function useLocalActiveParticipant() {
  const projectId = useSelectedProjectId();

  const getLocalActiveParticipantMap = useCallback((): ProjectParticipantMap => {
    try {
      // eslint-disable-next-line no-restricted-globals
      const stored = localStorage.getItem(ACTIVE_CONVERSATION_PARTICIPANT_KEY) || '{}';
      return JSON.parse(stored);
    } catch {
      return {};
    }
  }, []);

  const getLocalActiveParticipant = useCallback(
    (conversationId: string) => {
      const list = getLocalActiveParticipantMap()[projectId] || [];
      const foundItem = list.find((item) => item.cid === conversationId) || {};
      return {
        conversationId: foundItem.cid || '',
        participantId: foundItem.pid || '',
      };
    },
    [getLocalActiveParticipantMap, projectId],
  );

  const setLocalActiveParticipant = useCallback(
    (conversationId: string, participantId: string) => {
      const map = getLocalActiveParticipantMap();
      const list = map[projectId] || [];
      const foundItem = list.find((item) => item.cid === conversationId);
      const key = ACTIVE_CONVERSATION_PARTICIPANT_KEY;

      if (foundItem) {
        // eslint-disable-next-line no-restricted-globals
        localStorage.setItem(
          key,
          JSON.stringify({
            ...map,
            [projectId]: list.map((item) =>
              item.cid !== conversationId ? item : { cid: conversationId, pid: participantId },
            ),
          }),
        );
      } else {
        // eslint-disable-next-line no-restricted-globals
        localStorage.setItem(
          key,
          JSON.stringify({
            ...map,
            [projectId]: [{ cid: conversationId, pid: participantId }, ...list],
          }),
        );
      }
    },
    [getLocalActiveParticipantMap, projectId],
  );

  const clearLocalActiveParticipant = useCallback(
    (conversationId: string) => {
      const map = getLocalActiveParticipantMap();
      const list = map[projectId] || [];
      const leftList = list.filter((item) => item.cid !== conversationId);
      // eslint-disable-next-line no-restricted-globals
      localStorage.setItem(
        ACTIVE_CONVERSATION_PARTICIPANT_KEY,
        JSON.stringify({
          ...map,
          [projectId]: leftList,
        }),
      );
    },
    [getLocalActiveParticipantMap, projectId],
  );

  return { getLocalActiveParticipant, setLocalActiveParticipant, clearLocalActiveParticipant };
}

export default function useLocalActiveParticipantHook() {
  return useLocalActiveParticipant();
}
