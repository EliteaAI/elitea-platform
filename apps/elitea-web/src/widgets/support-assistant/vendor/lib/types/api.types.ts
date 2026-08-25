import type { TAssistantConfig } from './assistant.types';
import type { TConversationListItem, TConversationsResponse, TRawConversation } from './chat.types';

export type TChatAPI = {
  getConfig: () => Promise<TAssistantConfig>;
  getConversations: () => Promise<TConversationsResponse>;
  getConversation: (conversationId: string) => Promise<TRawConversation>;
  createConversation: () => Promise<TConversationListItem>;
  deleteConversation: (conversationId: string) => Promise<void>;
};
