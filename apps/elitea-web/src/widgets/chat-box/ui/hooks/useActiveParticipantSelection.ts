/**
 * Keeps the participant the user picked inside the ChatBox visible while the
 * host has none of its own.
 *
 * `/chat` owns `activeParticipant`, and it resets it every time a
 * conversation's participant list arrives: `src/pages/chat/index.tsx`'s
 * restore effect reads the last-active participant id out of local storage
 * and calls `setActiveParticipant(findActiveParticipantById(...))`, which is
 * `undefined` when nothing was stored. Picking an agent on a NEW chat lands
 * exactly there — the pick is what creates the conversation, so when
 * `onChange` fires the page still has no route id to store the choice under,
 * and the effect that runs straight after the navigation clears it again. The
 * agent stays attached and the turn does reach it (`useChatBoxSend.helpers`'s
 * `resolveTargetParticipant` falls back to the conversation's single
 * application participant), but the composer showed no agent at all, so the
 * pick read as if it had been dropped.
 *
 * The widget therefore remembers its own last pick and offers it while the
 * host supplies none. The memory is re-validated against the live participant
 * list on every render, which is what makes it self-clearing: participant row
 * ids are unique per row, so switching conversations or detaching the
 * participant drops the fallback with no teardown of its own.
 */
import { useCallback, useMemo, useState } from 'react';

/** `ChatBoxProps['participant']` — the host's active participant plus its setter. */
export interface ActiveParticipantProp {
  readonly active?: unknown;
  readonly onChange?: ((participant: unknown) => void) | undefined;
}

export interface ActiveParticipantSelection {
  readonly activeParticipant: unknown;
  readonly onChangeParticipant: (participant: unknown) => void;
}

/** Participant row ids are strings on this wire (`entities/participant`'s normaliser keeps only string fields); a number is accepted for the raw, un-normalised rows the host passes through. */
function participantRowId(participant: unknown): string | undefined {
  const id = (participant as { readonly id?: unknown } | null | undefined)?.id;
  if (typeof id === 'number') return String(id);
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function findParticipantRow(participants: readonly unknown[] | undefined, id: string | undefined): unknown {
  if (id === undefined) return undefined;
  return participants?.find((row) => participantRowId(row) === id);
}

export function useActiveParticipantSelection(
  participant: ActiveParticipantProp | undefined,
  conversationParticipants: readonly unknown[] | undefined,
): ActiveParticipantSelection {
  const [picked, setPicked] = useState<unknown>(undefined);
  const hostOnChange = participant?.onChange;
  const onChangeParticipant = useCallback((next: unknown) => {
    setPicked(next);
    hostOnChange?.(next);
  }, [hostOnChange]);
  const pickedId = participantRowId(picked);
  const remembered = useMemo(
    () => findParticipantRow(conversationParticipants, pickedId),
    [conversationParticipants, pickedId],
  );
  return { activeParticipant: participant?.active ?? remembered, onChangeParticipant };
}
