import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';

import { restoreAndRefreshDeviceRegistration } from '../../services/deviceRegistration';
import { CallService } from './CallService';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function incomingCode(notification: Notifications.Notification | undefined) {
  const data = notification?.request.content.data;
  return data?.type === 'incoming_voice_call' && typeof data.temporaryCallCode === 'string'
    ? data.temporaryCallCode
    : '';
}

export function DeviceRegistrationPrompt() {
  const handledCodes = useRef(new Set<string>());

  useEffect(() => {
    void CallService.resetStaleCallState();
    void restoreAndRefreshDeviceRegistration().catch(() => false);
    const answer = (notification: Notifications.Notification | undefined) => {
      const code = incomingCode(notification);
      if (!code || handledCodes.current.has(code)) return;
      handledCodes.current.add(code);
      void CallService.joinVoiceCall(code).catch(() => handledCodes.current.delete(code));
    };
    const listener = Notifications.addNotificationResponseReceivedListener((response) => answer(response.notification));
    void Notifications.getLastNotificationResponseAsync().then((response) => answer(response?.notification));
    return () => listener.remove();
  }, []);

  return null;
}
