/**
 * SoundNotificationSection — sound notification settings accordion.
 */
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { useSoundNotification } from '@/shared/lib/hooks/useSoundNotification';

import { SoundNotificationControls } from './SoundNotificationControls';

export function SoundNotificationSection() {
  const { config, setConfig, playCompletionSound } = useSoundNotification();

  return (
    <BasicAccordion
      showMode="left"
      slotSx={{
        accordion: {
          background: 'transparent !important',
          paddingTop: '0rem',
        },
      }}
      items={[
        {
          title: 'Sound Notifications',
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
