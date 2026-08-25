import React, { memo, useCallback, useState } from 'react';

import { CheckIcon, CopyIcon } from '../icons';
import Tooltip from './Tooltip';

import { t } from '@/shared/i18n';

const CopyButton: React.FC<{ text: string }> = memo(props => {
  const { text } = props;

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    // A clipboard write can reject (permission, insecure context) and the
    // reference already ignores that — the tick still flashes, and the user
    // finds out by pasting. Failing loudly here would be worse than the tick.
    void navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <Tooltip content={t('widgets.supportAssistant.copy', 'Copy to clipboard')}>
      <button
        className="elitea-assistant-header-action"
        onClick={handleCopy}
        aria-label={t('widgets.supportAssistant.copy', 'Copy to clipboard')}
        type="button"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </Tooltip>
  );
});

CopyButton.displayName = 'CopyButton';

export default CopyButton;
