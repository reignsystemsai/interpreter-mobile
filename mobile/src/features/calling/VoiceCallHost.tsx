import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import { API_BASE_URL } from '../../config/runtime';
import { getDeviceId, restoreAndRefreshDeviceRegistration } from '../../services/deviceRegistration';
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
  presentIncoming(data.callId, typeof data.callerPhoneNumber === 'string' ? data.callerPhoneNumber : 'Interpreter caller');
}

function presentIncoming(callId: string, callerPhoneNumber: string) {
  if (handledIncomingCallIds.has(callId)) return;
  const presented = VoiceCallService.presentIncomingCall({
    callId,
    callerPhoneNumber,
  });
  if (presented) handledIncomingCallIds.add(callId);
}

async function pollIncomingCall() {
  if (AppState.currentState !== 'active' || VoiceCallService.getState().status !== 'idle') return;
  const deviceId = await getDeviceId();
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/incoming?deviceId=${encodeURIComponent(deviceId)}`);
  if (!response.ok) return;
  const payload = (await response.json()) as { incoming?: boolean; callId?: string; callerPhoneNumber?: string };
  if (payload.incoming && payload.callId) presentIncoming(payload.callId, payload.callerPhoneNumber || 'Interpreter caller');
}

export function VoiceCallHost() {
  useEffect(() => {
    void restoreAndRefreshDeviceRegistration().catch(() => false);
    void pollIncomingCall().catch(() => undefined);
    const incomingPoll = setInterval(() => void pollIncomingCall().catch(() => undefined), 2_000);
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
      clearInterval(incomingPoll);
      void VoiceCallService.resetVoiceCall({ notifyBackend: true });
    };
  }, []);

  return <VoiceCallSurface />;
}
