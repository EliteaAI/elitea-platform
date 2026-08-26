import React, { memo } from 'react';

import AnimatedMessage from './AnimatedMessage';
import MarkdownContent from './MarkdownContent';
import StatusMessage from './StatusMessage';
import TypingIndicator from './TypingIndicator';
import { AssistantIcon, UserIcon } from '../icons';
import CopyButton from '../shared/CopyButton';
import type { TMessage } from '../../lib/types';
import { formatTime } from '../../lib/utils';

import { t } from '@/shared/i18n';

type TMessageItemProps = {
  message: TMessage;
  avatar: string;
  onAnimationComplete?: ((messageId: string) => void) | undefined;
};

const MessageItem: React.FC<TMessageItemProps> = memo(props => {
  const { message, avatar, onAnimationComplete } = props;

  const hasStatusMessage = message.role === 'assistant' && !!message.statusMessage;
  const showBubble = message.role === 'user' || message.content || (!hasStatusMessage && message.isStreaming);

  return (
    <div className={`elitea-assistant-message-wrapper elitea-assistant-message-wrapper--${message.role}`}>
      <div className={`elitea-assistant-message-meta elitea-assistant-message-meta--${message.role}`}>
        {message.role === 'assistant' && (
          <span className="elitea-assistant-message-avatar elitea-assistant-message-avatar--assistant">
            <AssistantIcon />
          </span>
        )}
        <span className="elitea-assistant-message-time">{formatTime(message.timestamp)}</span>
        {message.role === 'user' && (
          <span className="elitea-assistant-message-avatar elitea-assistant-message-avatar--user">
            {avatar ? (
              <img
                src={avatar}
                alt={t('widgets.supportAssistant.userAvatar', 'User avatar')}
                className="elitea-assistant-avatar-img"
              />
            ) : (
              <UserIcon />
            )}
          </span>
        )}
      </div>
      {hasStatusMessage && <StatusMessage message={message.statusMessage!} />}
      {showBubble && (
        <div
          className={`elitea-assistant-message elitea-assistant-message--${message.role}${message.isError ? ' elitea-assistant-message--error' : ''}`}
        >
          {message.content ? (
            message.role === 'assistant' ? (
              message.isAnimating ? (
                <AnimatedMessage
                  message={message}
                  onComplete={() => onAnimationComplete?.(message.id)}
                />
              ) : (
                <MarkdownContent content={message.content} />
              )
            ) : (
              message.content
            )
          ) : message.isStreaming ? (
            <TypingIndicator />
          ) : (
            ''
          )}
          {message.role === 'assistant' &&
            message.content &&
            !message.isStreaming &&
            !message.isAnimating && <CopyButton text={message.content} />}
        </div>
      )}
    </div>
  );
});

MessageItem.displayName = 'MessageItem';

export default MessageItem;
