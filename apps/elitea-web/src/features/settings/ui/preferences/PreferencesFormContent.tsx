/**
 * PreferencesFormContent — the body of Settings > Preferences.
 *
 * Composes the three accordions the baseline's
 * `features/settings/ui/preference/PreferencesFormContent.jsx` renders:
 * General, Voice Personalization, Sound Notifications.
 *
 * Voice Personalization and Sound Notifications are NOT re-implemented here:
 * both already exist in this slice under `ui/profile/` (they are also
 * rendered by Settings > Personalization), and both already persist to the
 * same `localStorage` keys the rest of the app reads —
 * `chat-input.voice-config` and `notifications.sound-config`. A second copy
 * would be a second store, which is the exact defect
 * `shared/lib/hooks/useSoundNotification.ts`'s doc comment records.
 *
 * There is no form state and no submit here: every control on this page
 * persists itself on change, so unlike `ProfileFormContent` this component
 * needs neither Formik nor a save bar.
 */
import Box from '@mui/material/Box';

import { SoundNotificationSection } from '../profile/SoundNotificationSection';
import { VoicePersonalizationSection } from '../profile/voice-config/VoicePersonalizationSection';

import { PreferencesGeneral } from './PreferencesGeneral';

export interface PreferencesFormContentProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId: string;
}

export function PreferencesFormContent({ projectId }: PreferencesFormContentProps) {
  return (
    <Box sx={styles.wrapper}>
      <Box sx={styles.container} data-testid="preferences-form-content">
        <PreferencesGeneral />
        <VoicePersonalizationSection projectId={projectId} />
        <SoundNotificationSection />
      </Box>
    </Box>
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    padding: '1.5rem',
    maxWidth: '50rem',
    width: '100%',
  },
};
