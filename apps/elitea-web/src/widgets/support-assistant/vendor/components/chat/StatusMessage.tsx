import { memo } from 'react';
import type { FC } from 'react';

type TStatusMessageProps = {
  message: string;
};

const StatusMessage: FC<TStatusMessageProps> = memo(props => {
  const { message } = props;

  if (!message) return null;

  return (
    <div className="elitea-assistant-status-message">
      {message.split('').map((char, index) => (
        <span
          key={`${message}-${index}`}
          className="elitea-assistant-status-message-char"
          style={{
            animationDelay: `${index * 0.1}s`,
            minWidth: char === ' ' ? '0.25em' : undefined,
          }}
        >
          {char === ' ' ? ' ' : char}
        </span>
      ))}
    </div>
  );
});

StatusMessage.displayName = 'StatusMessage';

export default StatusMessage;
