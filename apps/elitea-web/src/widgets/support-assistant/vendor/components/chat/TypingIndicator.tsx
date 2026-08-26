import React, { memo } from 'react';

const TypingIndicator: React.FC = memo(() => (
  <span className="elitea-assistant-typing-indicator">
    <span className="elitea-assistant-typing-dot" />
    <span className="elitea-assistant-typing-dot" />
    <span className="elitea-assistant-typing-dot" />
  </span>
));

TypingIndicator.displayName = 'TypingIndicator';

export default TypingIndicator;
