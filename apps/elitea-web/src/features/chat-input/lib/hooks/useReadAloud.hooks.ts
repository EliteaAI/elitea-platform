/**
 * Ported from
 * apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/useReadAloud.hooks.js —
 * the read-aloud / TTS glue hook shared by every surface that renders a
 * voice mini-player. Picks a TTS model (`section: 'tts'`) for server-side
 * speech, falling back to the browser's `SpeechSynthesis`, and tracks the
 * spoken word range for in-bubble highlighting.
 *
 * `useModelsList`/`useTtsVoices` — this slice's OWN `api/models.ts` (built
 * first by the sibling ASR unit, parameterized by `section` per this unit's
 * shared-fetcher build brief — see that file's own doc comment) and
 * `api/ttsVoices.ts` — replace the baseline's `useListModelsQuery`/
 * `useGetTtsVoicesQuery` RTK Query hooks (spec §2.3: TanStack Query, no
 * RTK Query anywhere in the new app).
 *
 * `socket` is accepted as an explicit parameter, same rationale as
 * `useTextToSpeech.hooks.ts`'s own doc comment (no `SocketClientContext.
 * Provider` mounted yet; `socket` legitimately absent is the browser-TTS
 * fallback path, not a programmer error).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SocketClient } from '@/shared/api/socket/client';

import { useModelsList } from '../../api/models';
import type { TtsVoice } from '../../api/ttsVoices';
import { useTtsVoices } from '../../api/ttsVoices';
import type { SpeakableText, TtsSegment } from '../helpers/ttsHelpers';
import { toSpeakableText } from '../helpers/ttsHelpers';

import { useTextToSpeech } from './useTextToSpeech.hooks';
import type { TtsModel, TtsSpokenRange } from './useTextToSpeech.types';
import type { VoiceConfig, VoiceConfigUpdate } from './useVoiceConfig.hooks';
import { useVoiceConfig } from './useVoiceConfig.hooks';

/** @public The props a caller spreads onto its voice mini-player / control button. */
export interface VoicePlayerProps {
  readonly voiceConfig: VoiceConfig;
  /** `hasModelTTS`: server voice rows (`TtsVoice`); otherwise the browser's own `SpeechSynthesisVoice` list. */
  readonly voices: readonly (TtsVoice | SpeechSynthesisVoice)[];
  readonly onVoiceConfigChange: (updates: VoiceConfigUpdate) => void;
  readonly ttsModel: TtsModel | null;
  readonly hasModelTTS: boolean;
  readonly isPlaying: boolean;
  readonly onStop: () => void;
  readonly onPlay: () => void;
}

/** @public */
export interface UseReadAloudParams {
  readonly projectId: string | undefined;
  readonly socket: SocketClient | null | undefined;
}

/** @public */
export interface UseReadAloudResult {
  readonly onAutoSpeak: (text: string, msgId?: string | number | null) => void;
  readonly speakingMessageId: string | number | null;
  readonly speakingSegments: readonly TtsSegment[] | null;
  readonly spokenRange: TtsSpokenRange | null;
  readonly showPlayer: boolean;
  readonly isPlaying: boolean;
  readonly stop: () => void;
  readonly voicePlayerProps: VoicePlayerProps;
}

function pickDefaultModel(items: readonly TtsModel[] | undefined): TtsModel | null {
  if (!items || items.length === 0) return null;
  return items.find((model) => model.default) ?? items[0] ?? null;
}

export function useReadAloud(params: UseReadAloudParams): UseReadAloudResult {
  const { projectId, socket } = params;
  const [speakingMessageId, setSpeakingMessageId] = useState<string | number | null>(null);
  const [speakingSegments, setSpeakingSegments] = useState<readonly TtsSegment[] | null>(null);

  const { data: ttsModelsData } = useModelsList({ projectId, section: 'tts', includeShared: true }, { enabled: !!projectId });
  const ttsModel = useMemo(() => pickDefaultModel(ttsModelsData?.items), [ttsModelsData]);
  const hasModelTTS = !!(ttsModel && socket);

  const { config: voiceConfig, setConfig: setVoiceConfig, browserVoices, resolvedBrowserVoice } = useVoiceConfig({ persist: false });
  const { data: ttsVoicesData } = useTtsVoices({ projectId: ttsModel?.project_id ?? projectId, modelName: ttsModel?.name }, { enabled: !!ttsModel });
  const displayVoices: readonly (TtsVoice | SpeechSynthesisVoice)[] = hasModelTTS ? (ttsVoicesData?.voices ?? []) : browserVoices;

  const {
    speak,
    stop: stopTTS,
    isPlaying,
    spokenRange,
    showPlayer,
    setShowPlayer,
    speakableText,
    setSpeakableText,
  } = useTextToSpeech({
    ttsModel,
    socket,
    voiceConfig: {
      voice: resolvedBrowserVoice,
      voiceId: voiceConfig.voiceId || undefined,
      rate: voiceConfig.rate,
      volume: voiceConfig.volume,
    },
  });

  const onAutoSpeak = useCallback(
    (text: string, msgId?: string | number | null) => {
      if (!text) return;
      const { text: convertedText, segments }: SpeakableText = toSpeakableText(text);
      if (!convertedText) return;
      setSpeakingMessageId(msgId ?? null);
      setSpeakingSegments(segments);
      setSpeakableText(convertedText);
      setShowPlayer(true);
    },
    [setShowPlayer, setSpeakableText],
  );

  const onPlay = useCallback(() => {
    speak(speakableText);
  }, [speak, speakableText]);

  // When playback ends, hide the player and clear the spoken-word highlight.
  useEffect(() => {
    if (!isPlaying) {
      setSpeakingMessageId(null);
      setSpeakingSegments(null);
      setShowPlayer(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  return {
    onAutoSpeak,
    speakingMessageId,
    speakingSegments,
    spokenRange,
    showPlayer,
    isPlaying,
    stop: stopTTS,
    voicePlayerProps: {
      voiceConfig,
      voices: displayVoices,
      onVoiceConfigChange: setVoiceConfig,
      ttsModel,
      hasModelTTS,
      isPlaying,
      onStop: stopTTS,
      onPlay,
    },
  };
}
