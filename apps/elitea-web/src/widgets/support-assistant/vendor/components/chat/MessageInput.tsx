/**
 * MessageInput — the assistant's message box.
 *
 * # ATTACHMENTS ARE NOT PORTED, and that is a decision rather than an omission
 *
 * The published widget's input carries a paperclip, drag-and-drop, clipboard
 * paste, per-file progress chips and a chunked uploader. All of it worked
 * because the socket payload had an `attachments: [filepath, …]` field the
 * LangGraph worker read.
 *
 * THIS PLATFORM'S AGENT-EXECUTION START CONTRACT HAS NO SUCH FIELD.
 * `CurrentApplicationStartRequest` carries `UserInput` and nothing free-form,
 * and the route REFUSES a start whose `attachments_info` is non-empty
 * (`internal/api/v2/agentexecution/route.go`). It is a platform-wide gap, not a
 * support-assistant one — the main chat surface only still sends attachments
 * because it can fall back to the socket, which this widget cannot.
 *
 * So a ported paperclip would have uploaded a file, stored it against the
 * conversation, shown a green tick, and sent the agent a question it had no way
 * to connect the file to. A user attaching a screenshot and asking "what is
 * wrong here?" would get a confidently irrelevant answer. A missing button is a
 * smaller lie than a working-looking one.
 *
 * The whole tree went with it rather than being left dormant —
 * `attachmentUpload.hook.ts`, `attachment.utils.ts`, the attachment chips, the
 * types and the size constants — because dormant code that looks wired is the
 * defect class this codebase keeps rediscovering. When the start contract grows
 * an attachments field (`libs/proto` work), this comes back from the reference
 * in one piece.
 *
 * The SUPPORT ASSISTANT CONTEXT is unaffected: the agent is still told which
 * page, project and entity the user is on. What it is not given is a file.
 */
import type { KeyboardEvent } from 'react';
import { memo, useCallback, useMemo } from 'react';

import { SendIcon } from '../icons';

import { t } from '@/shared/i18n';

type TMessageInputProps = {
  placeholder: string;
  text: string;
  onTextChange: (text: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean | undefined;
};

const MessageInput = memo((props: TMessageInputProps) => {
  const { placeholder, text, onTextChange, onSend, disabled } = props;

  const isSendDisabled = useMemo(() => Boolean(disabled) || text.trim() === '', [disabled, text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isSendDisabled) return;
    onTextChange('');
    onSend(trimmed);
  }, [text, isSendDisabled, onTextChange, onSend]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter is a newline — the reference's binding.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="elitea-assistant-input-area">
      <div className="elitea-assistant-input-row">
        <textarea
          id="elitea-assistant-message-input"
          className="elitea-assistant-input"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
        />
        <button
          className="elitea-assistant-send-button"
          onClick={handleSend}
          disabled={isSendDisabled}
          aria-label={t('widgets.supportAssistant.send', 'Send message')}
          type="button"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
});

MessageInput.displayName = 'MessageInput';

export default MessageInput;
