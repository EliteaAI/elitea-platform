import { useEffect, useState } from 'react';

import type { TAssistantConfig, TChatAPI, TConversationListItem, TRawConversation } from '../types';

type TInitAssistantProps = {
  api: TChatAPI;
  /**
   * The config the MOUNT GATE already fetched.
   *
   * The reference fetches it here, because the published widget is mounted
   * unconditionally and discovers whether it is enabled from inside. In this app
   * the decision is made one level up — `ui/SupportAssistantWidget.tsx` does not
   * mount this tree at all unless the server said `enabled` — so the answer is
   * already in hand, and fetching it again would be a second request for a
   * document this component was rendered BECAUSE of.
   */
  config: TAssistantConfig;
  title: string;
  welcomeMessage: string;
  placeholder: string;
};

type TInitAssistantResult = {
  title: string;
  welcomeMessage: string;
  placeholder: string;
  supportProjectId: number | null;
  history: TConversationListItem[];
  lastConversation: TRawConversation | null;
  isLoading: boolean;
  user: {
    id: number;
    name: string;
    avatar: string;
  };
};

export const useInitAssistant = (props: TInitAssistantProps): TInitAssistantResult => {
  const { api, config, title, welcomeMessage, placeholder } = props;

  const [history, setHistory] = useState<TConversationListItem[]>([]);
  const [lastConversation, setLastConversation] = useState<TRawConversation | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const conversationsPromise = api
      .getConversations()
      .then(async data => {
        if (cancelled) return;

        const items = data.items || [];
        setHistory(items);

        const mostRecent = items[0];
        if (mostRecent) {
          try {
            const conversation = await api.getConversation(mostRecent.uuid);
            if (!cancelled) setLastConversation(conversation);
          } catch {
            // last conversation details unavailable — chat will show welcome messages
          }
        }
      })
      .catch(() => {});

    // `void`: the promise already swallows its own rejections above, so this
    // chain cannot reject. It only flips the loading flag.
    void conversationsPromise.finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [api]);

  return {
    // The server's strings win; the props are the fallback for a deployment that
    // has not customised them. `||` and not `??` deliberately: an EMPTY string
    // from the server is "not set", not "render nothing".
    title: config.title || title,
    welcomeMessage: config.welcome_message || welcomeMessage,
    placeholder: config.placeholder || placeholder,
    supportProjectId: config.support_project_id ?? null,
    // Field-by-field, not `config.user ?? {…}`: the server sends the user block
    // whenever the assistant is enabled, but each member is optional on the
    // wire, so a present block with a missing avatar must still yield a usable
    // shape rather than an object with holes in it.
    user: {
      id: config.user?.id ?? 0,
      name: config.user?.name ?? 'Guest',
      avatar: config.user?.avatar ?? '',
    },
    history,
    lastConversation,
    isLoading,
  };
};
