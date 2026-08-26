import React, { memo } from 'react';

import { CloseIcon } from '../icons';

import { t } from '@/shared/i18n';

type TPopupMessageProps = {
  message: string;
  onClose: () => void;
};

const PopupMessage: React.FC<TPopupMessageProps> = memo(props => {
  const { message, onClose } = props;

  return (
    <div className="elitea-assistant-popup">
      <span className="elitea-assistant-popup-text">{message}</span>
      <button
        className="elitea-assistant-popup-close"
        onClick={onClose}
        aria-label={t('widgets.supportAssistant.closePopup', 'Close popup')}
        type="button"
      >
        <CloseIcon />
      </button>
    </div>
  );
});

PopupMessage.displayName = 'PopupMessage';

export default PopupMessage;
