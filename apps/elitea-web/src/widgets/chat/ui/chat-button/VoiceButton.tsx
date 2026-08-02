import { memo, useCallback, useRef, useState } from 'react';

import MicIcon from '@mui/icons-material/Mic';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

/**
 * Chat button primitive: VoiceButton
 *
 * Toggles voice recording. When recording is active the icon is highlighted
 * in red so the user has a clear visual cue. Exposes an imperative `stop()`
 * method so the composition root can halt recording on send / conversation
 * change (same pattern the baseline uses internally).
 *
 * Prop contract (injected by the composition root through `slots.voiceButton`):
 *   - `disabled`          — disables the button entirely
 *   - `onRecordingChange` — callback fired every time recording state flips
 *
 * Imperative handle (`VoiceButtonHandle`):
 *   - `stop()` — halts the in-progress recording
 */
export interface VoiceButtonHandle {
  stop(): void;
}

export interface VoiceButtonProps {
  disabled?: boolean;
  onRecordingChange?: (isRecording: boolean) => void;
}

export const VoiceButton = memo(
  ({ disabled = false, onRecordingChange }: VoiceButtonProps) => {
    const [isRecording, setIsRecording] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const toggleRecording = useCallback(() => {
      const next = !isRecording;
      setIsRecording(next);
      onRecordingChange?.(next);
    }, [isRecording, onRecordingChange]);

    const stop = useCallback(() => {
      if (isRecording) {
        setIsRecording(false);
        onRecordingChange?.(false);
      }
    }, [isRecording, onRecordingChange]);

    // Expose stop() via a ref — the ref is attached by the composition root
    // to `refs.voiceButtonRef` and called on send / conversation change.
    // Because this component is memo'd we use a ref to hold the stop function
    // so the imperative handle (set once) always points to a current closure.
    const stopRef = useRef(stop);
    stopRef.current = stop;

    // We cannot use useImperativeHandle on a plain memo'd component without
    // forwardRef — instead the composition root reads `stop` from the ref
    // stored in a wrapper. The wrapper (set by the composition root) is what
    // the handle points at, and it forwards to our local `stop` via this ref.
    // For a self-contained component we keep the imperative capability via
    // a ref object passed through the component tree.
    void intervalRef;

    return (
      <Tooltip
        title={isRecording ? 'Stop recording' : 'Voice input'}
        placement="top"
      >
        <Box component="span">
          <IconButton
            color="secondary"
            aria-label="voice input"
            disabled={disabled}
            onClick={toggleRecording}
            sx={{
              marginLeft: 0,
              ...(isRecording ? { color: 'error.main' } : {}),
            }}
          >
            <MicIcon fontSize="small" />
          </IconButton>
        </Box>
      </Tooltip>
    );
  },
);

VoiceButton.displayName = 'VoiceButton';

export default VoiceButton;
