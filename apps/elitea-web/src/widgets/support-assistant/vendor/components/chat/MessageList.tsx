import React, { memo, useEffect, useRef } from 'react';

import MessageItem from './MessageItem';
import MessageListSkeleton from './MessageListSkeleton';
import type { TMessage } from '../../lib/types';

import { t } from '@/shared/i18n';

type TMessageListProps = {
  avatar: string;
  messages: TMessage[];
  isLoading?: boolean | undefined;
  onAnimationComplete?: ((messageId: string) => void) | undefined;
};

const MessageList: React.FC<TMessageListProps> = memo(props => {
  const { avatar, messages, isLoading, onAnimationComplete } = props;
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;

    if (messages.length === 0) {
      hasScrolledRef.current = false;
      return;
    }

    const behavior = hasScrolledRef.current ? 'smooth' : 'instant';
    hasScrolledRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior });

    const isActive = messages.some(m => m.isStreaming || m.isAnimating);
    if (!isActive || !container) return;

    let rafId: number | null = null;

    const scheduleScroll = (unconditional = false) => {
      if (rafId !== null) return;

      rafId = requestAnimationFrame(() => {
        if (unconditional || container.scrollHeight - container.scrollTop - container.clientHeight < 150) {
          container.scrollTop = container.scrollHeight;
        }
        rafId = null;
      });
    };

    const mutationObserver = new MutationObserver(() => scheduleScroll());
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const resizeObserver = new ResizeObserver(() => scheduleScroll(true));
    resizeObserver.observe(container);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [messages]);

  if (isLoading) {
    return <MessageListSkeleton />;
  }

  if (messages.length === 0)
    return <div className="elitea-assistant-empty">{t('widgets.supportAssistant.empty', 'Send a message to start a conversation')}</div>;

  return (
    <div
      className="elitea-assistant-messages"
      ref={containerRef}
    >
      {messages.map(msg => (
        <MessageItem
          key={msg.id}
          message={msg}
          avatar={avatar}
          onAnimationComplete={onAnimationComplete}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
});

MessageList.displayName = 'MessageList';

export default MessageList;
