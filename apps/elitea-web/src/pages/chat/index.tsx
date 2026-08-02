import { memo } from 'react';

/**
 * Phase-3/4 NewChat page scaffold
 * Placeholder until Phase 5 (ChatBox composition root) is wired up.
 */
const NewChatWrapper = memo(() => {
  return (
    <div
      data-testid="new-chat-page"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
      }}
    >
      <p>New Chat — coming in Phase 5</p>
    </div>
  );
});

NewChatWrapper.displayName = 'NewChatWrapper';

export default NewChatWrapper;
