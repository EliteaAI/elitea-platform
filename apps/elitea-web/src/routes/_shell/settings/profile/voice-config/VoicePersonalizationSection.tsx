/**
 * VoicePersonalizationSection — local port of the voice personalization panel.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { AccordionConstants } from '@/shared/lib/constants';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { DiscreteSlider } from '@/shared/ui/DiscreteSlider';
import { SingleSelect } from '@/shared/ui/SingleSelect';
import { createStorage } from '@/shared/lib/storage';
import { useListModelsQuery } from '@/shared/api/configurationsApi';
import { useSelectedProjectStore } from '@/widgets/app-shell/model/selectedProject.store';

interface VoiceConfig {
  voiceName: string | null;
  voiceId: string | null;
  rate: number;
  volume: number;
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
        rate: typeof p.rate === 'number' ? Math.max(0.5, Math.min(2, p.rate as number)) : 1.0,
        volume: typeof p.volume === 'number' ? Math.max(0, Math.min(1, p.volume as number)) : 1.0,
      };
    }
  } catch {
    // Ignore.
  }
  return { ...DEFAULT_CONFIG };
}

export const VoicePersonalizationSection = memo(() => {
  const [config, setConfigState] = useState<VoiceConfig>(loadStored);
  const [browserVoices, setBrowserVoices] = useState<Array<{ name: string; localService: boolean }>>([]);

  const selectedProjectStore = useSelectedProjectStore((s) => s.project);
  const projectId = selectedProjectStore?.id ?? '';

  const { data: ttsModelsData } = useListModelsQuery(
    { projectId, include_shared: true },
    { enabled: !!projectId },
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => setBrowserVoices(window.speechSynthesis.getVoices() as Array<{ name: string; localService: boolean }>);
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const ttsModel = useMemo(
    () => ttsModelsData?.items?.find((m) => m.default) ?? ttsModelsData?.items?.[0] ?? null,
    [ttsModelsData],
  );

  const hasModelTTS = !!ttsModel;

  const displayVoices = hasModelTTS
    ? (ttsModelsData?.items as Array<{ name: string; localService: boolean } | unknown> ?? [])
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
    const name = typeof v === 'object' && v !== null && 'name' in v ? (v as { name: string }).name : '';
    const localService = typeof v === 'object' && v !== null && 'localService' in v ? (v as { localService: boolean }).localService : false;
    return hasModelTTS
      ? { value: name, label: name }
      : { value: name, label: `${name}${localService ? '' : ' (online)'}` };
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
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(VOICE_PREVIEW_TEXT);
    utterance.rate = previewVoiceConfig.rate ?? 1.0;
    utterance.volume = previewVoiceConfig.volume ?? 1.0;
    setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);
    window.speechSynthesis.speak(utterance);
  }, [previewVoiceConfig]);

  return (
    <BasicAccordion
      showMode={AccordionConstants.AccordionShowMode.LeftMode}
      slotSx={{ accordion: { background: 'transparent !important' } }}
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
