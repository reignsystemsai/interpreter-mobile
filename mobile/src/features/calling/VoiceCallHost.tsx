import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import { restoreAndRefreshDeviceRegistration } from '../../services/deviceRegistration';
import { VoiceCallService } from './VoiceCallService';
import { VoiceCallSurface } from './VoiceCallSurface';

const handledIncomingCallIds = new Set<string>();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function handleIncoming(notification?: Notifications.Notification) {
  const data = notification?.request.content.data;
  if (data?.type !== 'incoming_voice_call' || typeof data.callId !== 'string') return;
  if (handledIncomingCallIds.has(data.callId)) return;
  handledIncomingCallIds.add(data.callId);
  VoiceCallService.presentIncomingCall({
    callId: data.callId,
    callerPhoneNumber: typeof data.callerPhoneNumber === 'string' ? data.callerPhoneNumber : 'Interpreter caller',
  });
}

export function VoiceCallHost() {
  useEffect(() => {
    void restoreAndRefreshDeviceRegistration().catch(() => false);
    const foregroundListener = Notifications.addNotificationReceivedListener(handleIncoming);
    const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      handleIncoming(response.notification);
      void Notifications.clearLastNotificationResponseAsync();
    });
    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void VoiceCallService.handleAppForeground();
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      handleIncoming(response?.notification);
      if (response) void Notifications.clearLastNotificationResponseAsync();
    });
    return () => {
      foregroundListener.remove();
      responseListener.remove();
      appStateListener.remove();
      void VoiceCallService.resetVoiceCall({ notifyBackend: true });
    };
  }, []);

  return <VoiceCallSurface />;
}
