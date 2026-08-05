import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../test/webstorage';
import { renderWithProviders } from '../__tests__/testUtils';
import type { VoiceConfig } from '../lib/hooks/useVoiceConfig.hooks';

import { VoiceControlButton } from './VoiceControlButton';

// `VoiceConfigDialog` (rendered directly by `VoiceControlButton` — see that
// file's own module doc for the cross-cluster fix this test file exercises)
// reads/writes `localStorage` via `useVoiceConfig()`'s default `persist:
// true` — same shim `VoiceConfigDialog.test.tsx` itself installs.
installWebStorageShim();

const CONFIG: VoiceConfig = { voiceName: null, voiceId: null, rate: 1, volume: 1 };

function baseProps() {
  return {
    isPlaying: false,
    onPlay: vi.fn(),
    onStop: vi.fn(),
    voiceConfig: CONFIG,
    voices: [],
    onVoiceConfigChange: vi.fn(),
    ttsModel: null,
    hasModelTTS: false,
  };
}

describe('VoiceControlButton', () => {
  it('renders a play button (not playing) with a "Start speaking" tooltip label as its aria-label', () => {
    renderWithProviders(<VoiceControlButton {...baseProps()} />);
    expect(screen.getByTestId('chat-voice-play-stop-button')).toHaveAttribute('aria-label', 'Start speaking');
  });

  it('calls onPlay when not playing and the play/stop button is clicked', () => {
    const props = baseProps();
    renderWithProviders(<VoiceControlButton {...props} />);
    fireEvent.click(screen.getByTestId('chat-voice-play-stop-button'));
    expect(props.onPlay).toHaveBeenCalledOnce();
    expect(props.onStop).not.toHaveBeenCalled();
  });

  it('renders a stop control and calls onStop when isPlaying is true', () => {
    const props = { ...baseProps(), isPlaying: true };
    renderWithProviders(<VoiceControlButton {...props} />);
    expect(screen.getByTestId('chat-voice-play-stop-button')).toHaveAttribute('aria-label', 'Stop speaking');
    fireEvent.click(screen.getByTestId('chat-voice-play-stop-button'));
    expect(props.onStop).toHaveBeenCalledOnce();
    expect(props.onPlay).not.toHaveBeenCalled();
  });

  it('disables the settings button while playing', () => {
    renderWithProviders(<VoiceControlButton {...{ ...baseProps(), isPlaying: true }} />);
    expect(screen.getByTestId('chat-voice-settings-button')).toBeDisabled();
  });

  it('opens the real VoiceConfigDialog when the settings button is clicked', () => {
    renderWithProviders(<VoiceControlButton {...baseProps()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-voice-settings-button'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Voice settings')).toBeInTheDocument();
  });

  it('Apply forwards the dialog-staged config to onVoiceConfigChange and closes the dialog', async () => {
    const props = baseProps();
    renderWithProviders(<VoiceControlButton {...props} />);

    fireEvent.click(screen.getByTestId('chat-voice-settings-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(props.onVoiceConfigChange).toHaveBeenCalledWith(CONFIG);
    // MUI's `Dialog` exit transition keeps the node mounted for a beat after
    // `open` flips to `false` — `waitFor` (same pattern as this slice's own
    // `VariablesEditor.test.tsx`) rather than a synchronous assertion.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Cancel closes the dialog without calling onVoiceConfigChange', async () => {
    const props = baseProps();
    renderWithProviders(<VoiceControlButton {...props} />);

    fireEvent.click(screen.getByTestId('chat-voice-settings-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onVoiceConfigChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
