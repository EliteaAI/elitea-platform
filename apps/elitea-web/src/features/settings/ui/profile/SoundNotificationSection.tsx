/**
 * SoundNotificationSection — sound notification settings accordion.
 */
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { useSoundNotification } from '@/shared/lib/hooks/useSoundNotification';

import { SoundNotificationControls } from './SoundNotificationControls';
import { t } from '@/shared/i18n';

export function SoundNotificationSection() {
  const { config, setConfig, playCompletionSound } = useSoundNotification();

  return (
    <BasicAccordion
      showMode="left"
      slotSx={{
        accordion: {
          background: 'transparent',
          paddingTop: '0rem',
        },
      }}
      items={[
        {
          title: t('settings.profile.soundNotifications.title', 'Sound Notifications'),
          content: (
            <SoundNotificationControls
              config={config}
              setConfig={setConfig}
              playCompletionSound={playCompletionSound}
            />
          ),
        },
      ]}
    />
  );
}
