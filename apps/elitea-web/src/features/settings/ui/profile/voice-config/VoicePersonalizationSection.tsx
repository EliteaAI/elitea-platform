/**
 * VoicePersonalizationSection — local port of the voice personalization panel.
 */
import { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { AccordionConstants } from '@/shared/lib/constants';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { DiscreteSlider } from '@/shared/ui/DiscreteSlider';
import { SingleSelect } from '@/shared/ui/SingleSelect';
import { createStorage } from '@/shared/lib/storage';
import { useListModelsQuery } from '@/shared/api/configurationsApi';
import { eliteaFetch } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';

interface VoiceConfig {
  voiceName: string | null;
  voiceId: string | null;
  rate: number;
  volume: number;
}

/** One server-side TTS voice — mirrors `features/chat-input/api/ttsVoices.ts`'s `TtsVoice`. */
interface SettingsTtsVoice {
  readonly id?: string;
  readonly name: string;
}

/**
 * `GET /configurations/tts_voices/{projectId}?model_name=...` — local,
 * disclosed near-duplicate of `features/chat-input/api/ttsVoices.ts`'s
 * `getTtsVoices` (same route/shape that file's own doc comment already
 * discloses duplicating from `features/credentials`). `no-sideways-features`
 * (`.dependency-cruiser.cjs`) forbids `features/settings` importing either
 * feature-private module, so this is copied rather than reached into.
 */
async function fetchSettingsTtsVoices(
  projectId: string,
  modelName: string | undefined,
): Promise<readonly SettingsTtsVoice[]> {
  const search = new URLSearchParams();
  if (modelName !== undefined) search.append('model_name', modelName);
  const envelope = await eliteaFetch<{ data?: { voices?: readonly SettingsTtsVoice[] } }>(
    `/configurations/tts_voices/${projectId}?${search.toString()}`,
  );
  return envelope.data?.voices ?? [];
}

const STORAGE_KEY = 'chat-input.voice-config';
const DEFAULT_CONFIG: VoiceConfig = { voiceName: null, voiceId: null, rate: 1.0, volume: 1.0 };

const VOICE_PREVIEW_TEXT = 'Hello, this is a voice preview.';
const VOICE_SPEED_MARKS = [
  { value: 0.5, label: '0.5×' },
  { value: 1.0, label: '1.0×' },
  { value: 2.0, label: '2.0×' },
];
const VOICE_VOLUME_MARKS = [
  { value: 0, label: '0%' },
  { value: 0.5, label: '50%' },
  { value: 1, label: '100%' },
];

function loadStored(): VoiceConfig {
  const store = createStorage('local');
  const raw = store.get(STORAGE_KEY);
  if (raw === null) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const p = parsed as Record<string, unknown>;
      return {
        voiceName: (p.voiceName as string | null) ?? null,
        voiceId: (p.voiceId as string | null) ?? null,
        rate: typeof p.rate === 'number' ? Math.max(0.5, Math.min(2, p.rate)) : 1.0,
        volume: typeof p.volume === 'number' ? Math.max(0, Math.min(1, p.volume)) : 1.0,
      };
    }
  } catch {
    // Ignore.
  }
  return { ...DEFAULT_CONFIG };
}

export interface VoicePersonalizationSectionProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId: string;
}

export const VoicePersonalizationSection = memo(({ projectId }: VoicePersonalizationSectionProps) => {
  const [config, setConfigState] = useState<VoiceConfig>(loadStored);
  const [browserVoices, setBrowserVoices] = useState<Array<{ name: string; localService: boolean }>>([]);

  const socket = useContext(SocketClientContext);

  const { data: ttsModelsData } = useListModelsQuery(
    { projectId, include_shared: true },
    { enabled: !!projectId },
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => setBrowserVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const ttsModel = useMemo(
    () => ttsModelsData?.items?.find((m) => m.default) ?? ttsModelsData?.items?.[0] ?? null,
    [ttsModelsData],
  );

  // Matches the old app / the sibling `features/chat-input` port
  // (`hasModelTTS = !!(ttsModel && socket)`): model-backed TTS needs a live
  // socket connection, not just a resolved model — otherwise there is
  // nothing to actually stream audio back from.
  const hasModelTTS = !!(ttsModel && socket);

  const { data: ttsVoicesData } = useQuery({
    queryKey: ['settings', 'tts-voices', ttsModel?.project_id ?? projectId, ttsModel?.name],
    queryFn: () => fetchSettingsTtsVoices(ttsModel?.project_id ?? projectId, ttsModel?.name),
    enabled: hasModelTTS,
  });

  const displayVoices: readonly (SettingsTtsVoice | { name: string; localService: boolean })[] = hasModelTTS
    ? (ttsVoicesData ?? [])
    : browserVoices;

  const handleConfigChange = useCallback((updates: Partial<VoiceConfig>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...updates };
      try {
        const store = createStorage('local');
        store.set(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore.
      }
      return next;
    });
  }, []);

  const handleVoiceChange = useCallback(
    (value: string) => {
      handleConfigChange(
        hasModelTTS ? { voiceId: value || null, voiceName: null } : { voiceName: value || null, voiceId: null },
      );
    },
    [handleConfigChange, hasModelTTS],
  );

  const handleRateChange = useCallback((value: number) => handleConfigChange({ rate: value }), [handleConfigChange]);
  const handleVolumeChange = useCallback((value: number) => handleConfigChange({ volume: value }), [handleConfigChange]);

  const selectedVoiceValue = hasModelTTS ? (config.voiceId ?? '') : (config.voiceName ?? '');

  const voiceOptions = displayVoices.map((v) => {
    if (hasModelTTS) {
      const voice = v as SettingsTtsVoice;
      return { value: voice.id ?? voice.name, label: voice.name };
    }
    const voice = v as { name: string; localService: boolean };
    return { value: voice.name, label: `${voice.name}${voice.localService ? '' : ' (online)'}` };
  }).filter((v) => v.value !== '');

  const previewVoiceConfig = useMemo(
    () => ({
      rate: config.rate ?? 1.0,
      volume: config.volume ?? 1.0,
    }),
    [config],
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const handlePreview = useCallback(() => {
    if (hasModelTTS) {
      // Model-backed preview needs the socket + Web Audio TTS engine
      // (`features/chat-input/lib/hooks/useTextToSpeech.hooks.ts` +
      // `useModelTtsEngine.hooks.ts`). That engine is feature-private to
      // `features/chat-input`; `no-sideways-features` forbids importing it
      // from here, and duplicating its socket protocol / audio scheduling
      // is out of this fix's scope — it needs a shared-home promotion first
      // (the same path `ThemeModeToggle` took to `shared/ui` for this exact
      // page). No-op rather than silently playing the wrong (browser) voice
      // under the configured model voice's label.
      return;
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(VOICE_PREVIEW_TEXT);
    utterance.rate = previewVoiceConfig.rate ?? 1.0;
    utterance.volume = previewVoiceConfig.volume ?? 1.0;
    setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);
    window.speechSynthesis.speak(utterance);
  }, [hasModelTTS, previewVoiceConfig]);

  return (
    <BasicAccordion
      showMode={AccordionConstants.AccordionShowMode.LeftMode}
      slotSx={{ accordion: { background: 'transparent' } }}
      data-testid="voice-personalization-section"
      items={[
        {
          title: 'Voice Personalization',
          content: (
            <Box sx={styles.content}>
              {voiceOptions.length > 0 && (
                <SingleSelect
                  label="Voice"
                  value={selectedVoiceValue}
                  options={voiceOptions}
                  onChange={handleVoiceChange}
                  placeholder="Default"
                />
              )}
              <Box sx={styles.sliderRow}>
                <Typography variant="caption" sx={styles.sliderLabel}>
                  Speed
                </Typography>
                <DiscreteSlider
                  value={config.rate}
                  onChange={handleRateChange}
                  min={0.5}
                  max={2}
                  levels={VOICE_SPEED_MARKS}
                />
              </Box>
              <Box sx={styles.sliderRow}>
                <Typography variant="caption" sx={styles.sliderLabel}>
                  Volume
                </Typography>
                <DiscreteSlider
                  value={config.volume}
                  onChange={handleVolumeChange}
                  min={0}
                  max={1}
                  levels={VOICE_VOLUME_MARKS}
                />
              </Box>
              {!isPlaying && (
                <Box>
                  <BaseBtn
                    variant="elitea"
                    color="secondary"
                    loading={isPlaying}
                    onClick={handlePreview}
                    data-testid="voice-preview-button"
                  >
                    Preview Voice
                  </BaseBtn>
                </Box>
              )}
            </Box>
          ),
        },
      ]}
    />
  );
});

VoicePersonalizationSection.displayName = 'VoicePersonalizationSection';

const styles = {
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  sliderRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    px: '0.25rem',
  },
  sliderLabel: {
    color: 'text.secondary',
  },
};
