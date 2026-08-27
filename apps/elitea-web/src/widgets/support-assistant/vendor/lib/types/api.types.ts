import type { TConversationListItem, TConversationsResponse, TRawConversation } from './chat.types';

export type TChatAPI = {
  getConversations: () => Promise<TConversationsResponse>;
  getConversation: (conversationId: string) => Promise<TRawConversation>;
  createConversation: () => Promise<TConversationListItem>;
};
