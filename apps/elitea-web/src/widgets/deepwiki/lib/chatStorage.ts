/**
 * Where one wiki's conversation is kept between visits.
 *
 * THE NAMESPACE IS THE POINT. The legacy drawer wrote
 * `deepwiki-chat-{project}-{toolkit}` straight onto `localStorage`, and a raw
 * key like that survives sign-out: `clearNamespace()` sweeps the `el.` prefix
 * and nothing else, so the previous user's questions are still on the machine
 * for the next one (issue #22). Going through `createStorage` is what puts
 * these two keys inside the sweep.
 *
 * A CORRUPT VALUE READS AS ABSENT rather than throwing. `getJSON` already does
 * that; the capability read repeats the rule for a value that is present but
 * is not one of the two words.
 */
import { createStorage } from '@/shared/lib/storage';
import type { ChatCapability, ChatMessage, ChatStorage } from '@/features/wiki-chat';

const store = createStorage('local');

function messagesKey(projectId: number | string, toolkitId: number | string): string {
  return `deepwiki.chat.${projectId}.${toolkitId}`;
}

function capabilityKey(projectId: number | string, toolkitId: number | string): string {
  return `deepwiki.chat.capability.${projectId}.${toolkitId}`;
}

export function createWikiChatStorage(
  projectId: number | string,
  toolkitId: number | string,
): ChatStorage {
  const forMessages = messagesKey(projectId, toolkitId);
  const forCapability = capabilityKey(projectId, toolkitId);

  return {
    loadMessages: () => {
      // A stored value that is not an array is not half a conversation — it is
      // a different shape, and rendering it would crash the drawer on open.
      // `getJSON`'s validator is where that check belongs: it already turns a
      // rejected value into null, so there is one rule and not two.
      const stored = store.getJSON<readonly ChatMessage[]>(forMessages, (raw) =>
        Array.isArray(raw) ? (raw as readonly ChatMessage[]) : (undefined as never),
      );
      return stored ?? [];
    },
    saveMessages: (messages) => {
      store.setJSON(forMessages, messages);
    },
    loadCapability: () => {
      const stored = store.get(forCapability);
      return stored === 'ask' || stored === 'research' ? stored : null;
    },
    saveCapability: (capability: ChatCapability) => {
      store.set(forCapability, capability);
    },
  };
}
