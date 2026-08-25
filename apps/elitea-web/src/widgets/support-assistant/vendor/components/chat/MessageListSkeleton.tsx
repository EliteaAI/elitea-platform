import React, { memo } from 'react';

const MessageListSkeleton: React.FC = memo(() => (
  <div className="elitea-assistant-messages">
    {Array.from({ length: 3 }).map((_, i) => (
      <div
        key={i}
        className={`elitea-assistant-skeleton-row ${i % 2 === 0 ? 'elitea-assistant-skeleton-row--left' : 'elitea-assistant-skeleton-row--right'}`}
      >
        <div className="elitea-assistant-skeleton-meta">
          <div className="elitea-assistant-skeleton elitea-assistant-skeleton--avatar" />
          <div className="elitea-assistant-skeleton elitea-assistant-skeleton--time" />
        </div>
        <div className="elitea-assistant-skeleton elitea-assistant-skeleton--bubble" />
      </div>
    ))}
  </div>
));

MessageListSkeleton.displayName = 'MessageListSkeleton';

export default MessageListSkeleton;
