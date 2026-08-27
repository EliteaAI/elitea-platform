import React, { memo } from 'react';

import { AssistantIcon } from '../icons';

import { t } from '@/shared/i18n';

type TChatButtonProps = {
  onClick: () => void;
};

const ChatButton: React.FC<TChatButtonProps> = memo(props => {
  const { onClick } = props;

  return (
    <button
      className="elitea-assistant-button"
      onClick={onClick}
      aria-label={t('widgets.supportAssistant.open', 'Support Assistant')}
      type="button"
    >
      <AssistantIcon />
    </button>
  );
});

ChatButton.displayName = 'ChatButton';

export default ChatButton;
