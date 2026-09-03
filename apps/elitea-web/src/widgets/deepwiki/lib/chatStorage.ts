/**
 * What one wiki chat still keeps in the browser, and what it no longer does.
 *
 * THE TRANSCRIPT IS GONE FROM HERE. It used to live under
 * `deepwiki.chat.{project}.{toolkit}`, which meant a conversation was gone on
 * another device, in another browser and on a cleared profile, and no other
 * person could ever see it. elitea-main now writes both turns of every wiki
 * chat into the tenant chat tables as they happen; the drawer reads them back
 * (`../api/wikiHistoryApi.ts`) and writes none of them.
 *
 * WHAT IS LEFT is two things that are genuinely local:
 *
 *   - the capability toggle's last position, which is a preference and not a
 *     record — every stored answer carries the capability it was produced
 *     with;
 *   - the conversation KEY, which is how this browser says "the same chat as
 *     last time" to the server. It is an opaque, unguessable handle; the
 *     server resolves it only against conversations belonging to the caller,
 *     so it is a bookmark, never a credential.
 *
 * AND THE MIGRATION. `readLocalWikiMessages` still reads the old transcript
 * key, so a user who had a conversation before this change sees it rather
 * than an empty drawer. It is never uploaded — a client-authored assistant
 * turn is forgery — and it is forgotten only once the server has a
 * conversation of its own for that toolkit, so nothing is destroyed before it
 * has been replaced.
 *
 * THE NAMESPACE IS THE POINT, and it is why every key goes through
 * `createStorage`. The legacy drawer wrote `deepwiki-chat-{project}-{toolkit}`
 * straight onto `localStorage`, and a raw key like that survives sign-out:
 * `clearNamespace()` sweeps the `el.` prefix and nothing else, so the previous
 * user's questions were still on the machine for the next one (issue #22).
 *
 * A CORRUPT VALUE READS AS ABSENT rather than throwing.
 */
import { createStorage } from '@/shared/lib/storage';
import type { ChatCapability, ChatMessage, ChatStorage } from '@/features/wiki-chat';

const store = createStorage('local');

/** The key the pre-server drawer kept its whole conversation under. */
function legacyMessagesKey(projectId: number | string, toolkitId: number | string): string {
  return `deepwiki.chat.${projectId}.${toolkitId}`;
}

function capabilityKey(projectId: number | string, toolkitId: number | string): string {
  return `deepwiki.chat.capability.${projectId}.${toolkitId}`;
}

function conversationKey(projectId: number | string, toolkitId: number | string): string {
  return `deepwiki.chat.conversation.${projectId}.${toolkitId}`;
}

export function createWikiChatStorage(
  projectId: number | string,
  toolkitId: number | string,
): ChatStorage {
  const forCapability = capabilityKey(projectId, toolkitId);

  return {
    loadCapability: () => {
      const stored = store.get(forCapability);
      return stored === 'ask' || stored === 'research' ? stored : null;
    },
    saveCapability: (capability: ChatCapability) => {
      store.set(forCapability, capability);
    },
  };
}

/**
 * This browser's handle on the toolkit's current conversation.
 *
 * `read` returns the standing one, minting a first if there is none; `renew`
 * is what "Clear" means now — not "erase the transcript", which is somebody's
 * history, but "start a new conversation", which leaves the old one listed
 * and readable.
 */
export interface WikiConversationKey {
  readonly read: () => string;
  readonly renew: () => string;
}

export function createWikiConversationKey(
  projectId: number | string,
  toolkitId: number | string,
  newId: () => string,
): WikiConversationKey {
  const key = conversationKey(projectId, toolkitId);
  const mint = (): string => {
    const minted = newId();
    store.set(key, minted);
    return minted;
  };
  return {
    read: () => store.get(key) ?? mint(),
    renew: mint,
  };
}

/**
 * The conversation this browser kept before the server did.
 *
 * A stored value that is not an array is not half a conversation — it is a
 * different shape, and rendering it would crash the drawer on open.
 * `getJSON`'s validator is where that check belongs: it already turns a
 * rejected value into null, so there is one rule and not two.
 */
export function readLocalWikiMessages(
  projectId: number | string,
  toolkitId: number | string,
): readonly ChatMessage[] {
  const stored = store.getJSON<readonly ChatMessage[]>(
    legacyMessagesKey(projectId, toolkitId),
    (raw) => (Array.isArray(raw) ? (raw as readonly ChatMessage[]) : (undefined as never)),
  );
  return stored ?? [];
}

/**
 * Forget the local transcript.
 *
 * Called ONLY once the server holds a conversation for this toolkit, so the
 * old copy is dropped after it has been replaced and never instead of it. A
 * browser whose user never asks another question keeps its old conversation
 * indefinitely, which is the right way round: this deletes nothing the user
 * has not already got back.
 */
export function forgetLocalWikiMessages(
  projectId: number | string,
  toolkitId: number | string,
): void {
  store.remove(legacyMessagesKey(projectId, toolkitId));
}
