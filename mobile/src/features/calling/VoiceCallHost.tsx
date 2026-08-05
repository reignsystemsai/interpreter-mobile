import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Alert, AppState, Linking } from 'react-native';

import { API_BASE_URL } from '../../config/runtime';
import {
  enableCallNotifications,
  getDeviceId,
  getRegisteredPhoneNumber,
  markCallNotificationOfferShown,
  registerDeviceInstallation,
  restoreAndRefreshDeviceRegistration,
  wasCallNotificationOfferShown,
} from '../../services/deviceRegistration';
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

async function enableNotificationsFromOffer() {
  try {
    const enabled = await enableCallNotifications();
    if (!enabled) {
      Alert.alert('Notifications are off', 'Turn on notifications in Settings so Interpreter can alert you to incoming calls.', [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]);
    }
  } catch {
    Alert.alert('Unable to enable notifications', 'Please try again from Interpreter settings.');
  }
}

function updateIncomingCallNumber(currentPhoneNumber: string) {
  Alert.prompt(
    'Your Interpreter phone number',
    'Enter the number other people have saved for you so their calls can reach this phone.',
    (phoneNumber) => {
      void registerDeviceInstallation(phoneNumber)
        .then(() => enableNotificationsFromOffer())
        .catch(() => Alert.alert('Unable to save number', 'Enter a valid phone number including area code.'));
    },
    'plain-text',
    currentPhoneNumber,
    'phone-pad',
  );
}

async function offerCallNotificationsAfterFirstCall() {
  if (await wasCallNotificationOfferShown()) return;
  const permission = await Notifications.getPermissionsAsync();
  await markCallNotificationOfferShown();
  if (permission.status === 'granted') {
    await restoreAndRefreshDeviceRegistration().catch(() => false);
    return;
  }
  const phoneNumber = await getRegisteredPhoneNumber().catch(() => null);
  Alert.alert(
    'Never miss a call',
    `Turn on notifications now.${phoneNumber ? `\n\nIncoming calls are registered to ${phoneNumber}.` : ''}`,
    [
      { text: 'Not Now', style: 'cancel' },
      ...(phoneNumber ? [{ text: 'Update Number', onPress: () => updateIncomingCallNumber(phoneNumber) }] : []),
      { text: 'Turn On Notifications', onPress: () => void enableNotificationsFromOffer() },
    ],
  );
}

export function VoiceCallHost() {
  useEffect(() => {
    let completedConnectedCall = false;
    let previousStatus = VoiceCallService.getState().status;
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
    const callStateListener = VoiceCallService.subscribe((state) => {
      if (state.status === 'connected') completedConnectedCall = true;
      if (completedConnectedCall && state.status === 'idle' && previousStatus !== 'idle') {
        completedConnectedCall = false;
        void offerCallNotificationsAfterFirstCall().catch(() => undefined);
      }
      previousStatus = state.status;
    });
    return () => {
      foregroundListener.remove();
      responseListener.remove();
      appStateListener.remove();
      callStateListener();
      clearInterval(incomingPoll);
      void VoiceCallService.resetVoiceCall({ notifyBackend: true });
    };
  }, []);

  return <VoiceCallSurface />;
}
