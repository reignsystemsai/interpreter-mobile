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
import { backendMediaAdapter } from '../../shells/audio/BackendMediaAdapter';
import { CallingShellHost } from '../../shells/calling/CallingShellHost';
import type { CallSession } from '../../shells/data/CallSession';
import { VoiceCallService } from './VoiceCallService';
import { VoiceCallSurface } from './VoiceCallSurface';

const handledIncomingCallIds = new Set<string>();
const handledCanonicalCallIds = new Set<string>();

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

type IncomingCallSessionPayload = {
  incoming: boolean;
  callId?: string;
  callerDeviceId?: string;
  callerPhoneNumber?: string;
  callerLanguage?: string;
  recipientLanguage?: string;
  callerParticipantIdentity?: string;
  recipientParticipantIdentity?: string;
};

// Foreground-only discovery for canonical (speak_call_sessions) calls — push delivery
// is a separate, later phase; this poll is the sole discovery mechanism for now.
// Never reads or writes active_calls.
async function pollIncomingCallSession() {
  if (AppState.currentState !== 'active' || VoiceCallService.getState().status !== 'idle') return;
  const deviceId = await getDeviceId();
  const response = await fetch(`${API_BASE_URL}/api/v1/call-sessions/incoming?deviceId=${encodeURIComponent(deviceId)}`);
  if (!response.ok) return;
  const payload = (await response.json()) as IncomingCallSessionPayload;
  if (
    !payload.incoming ||
    !payload.callId ||
    !payload.callerDeviceId ||
    !payload.callerLanguage ||
    !payload.recipientLanguage ||
    !payload.callerParticipantIdentity ||
    !payload.recipientParticipantIdentity ||
    handledCanonicalCallIds.has(payload.callId) ||
    handledIncomingCallIds.has(payload.callId)
  ) {
    return;
  }

  const session: CallSession = {
    callId: payload.callId,
    callerDeviceId: payload.callerDeviceId,
    recipientDeviceId: null,
    callerLanguage: payload.callerLanguage,
    recipientLanguage: payload.recipientLanguage,
    callerParticipantIdentity: payload.callerParticipantIdentity,
    recipientParticipantIdentity: payload.recipientParticipantIdentity,
    status: 'ringing',
  };
  try {
    CallingShellHost.presentIncomingCall(session);
  } catch {
    return; // a call is already active locally; ignore until it clears
  }
  VoiceCallService.markCanonicalCall(payload.callId);
  const presented = VoiceCallService.presentIncomingCall({ callId: payload.callId, callerPhoneNumber: payload.callerPhoneNumber || 'Interpreter caller' });
  if (presented) handledCanonicalCallIds.add(payload.callId);
}

// Bridges VoiceCallSurface's Answer/Decline/End button presses (which call
// VoiceCallService directly and are not modified this phase) into the canonical
// CallingShellHost + BackendMediaAdapter, for calls CallingShellHost currently owns.
// A call whose id does not match CallingShellHost's current session is left
// completely alone — this never touches a legacy (non-canonical) call.
async function bridgeAnswer(callId: string) {
  try {
    await CallingShellHost.answerCall(callId);
    await backendMediaAdapter.connect(callId, VoiceCallService.getState().remoteLabel, 'recipient');
  } catch {
    // Failure at either step (including the recipient denying mic access, which
    // rejects inside connect()) must not leave this device's reservation active —
    // release the call on the backend, not just the local media state.
    void CallingShellHost.endCall(callId).catch(() => undefined);
    void VoiceCallService.disconnectMedia();
  }
}

function bridgeCallStateChange(previousStatus: string, previousCallId: string | null, nextStatus: string) {
  if (!previousCallId) return;
  const canonicalSession = CallingShellHost.getSession();
  if (!canonicalSession || canonicalSession.callId !== previousCallId) return;

  if (previousStatus === 'ringing' && nextStatus === 'connecting') {
    void bridgeAnswer(previousCallId);
    return;
  }
  if (nextStatus === 'idle') {
    if (previousStatus === 'ringing') void CallingShellHost.declineCall(previousCallId).catch(() => undefined);
    else void CallingShellHost.endCall(previousCallId).catch(() => undefined);
  }
}

// Once both sides are actually connected in the same LiveKit room, one side
// disconnecting is detected by the other via LiveKit's own participant-disconnected
// event (see VoiceCallService.connect). Before that point — most importantly, a
// caller waiting for pickup while the recipient declines, which never joins a room
// at all — there is no such signal. This poll is that missing signal: while this
// device's canonical session exists but has not yet reached "connected", check
// whether the call is already over on the backend, and if so, release this device's
// reservation and clear local state instead of leaving it stuck.
async function pollCanonicalCallLiveness() {
  const session = CallingShellHost.getSession();
  if (!session || session.status === 'connected') return;
  if (session.status !== 'ringing' && session.status !== 'connecting' && session.status !== 'reconnecting') return;
  const deviceId = await getDeviceId().catch(() => '');
  if (!deviceId) return;
  const response = await fetch(`${API_BASE_URL}/api/v1/call-sessions/${encodeURIComponent(session.callId)}?deviceId=${encodeURIComponent(deviceId)}`).catch(() => null);
  if (!response?.ok) return;
  const payload = (await response.json().catch(() => ({}))) as { found?: boolean; call?: { status?: string } };
  const remoteEnded = payload.found === false || payload.call?.status === 'ended' || payload.call?.status === 'failed';
  if (!remoteEnded) return;
  await CallingShellHost.endCall(session.callId).catch(() => undefined);
  await VoiceCallService.disconnectMedia();
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
    backendMediaAdapter.start();
    VoiceCallService.setCanonicalEndHandler((callId) => CallingShellHost.endCall(callId));
    let completedConnectedCall = false;
    let previousStatus = VoiceCallService.getState().status;
    let previousCallId = VoiceCallService.getState().callId;
    void restoreAndRefreshDeviceRegistration().catch(() => false);
    void pollIncomingCall().catch(() => undefined);
    void pollIncomingCallSession().catch(() => undefined);
    const incomingPoll = setInterval(() => {
      void pollIncomingCall().catch(() => undefined);
      void pollIncomingCallSession().catch(() => undefined);
      void pollCanonicalCallLiveness().catch(() => undefined);
    }, 2_000);
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
      bridgeCallStateChange(previousStatus, previousCallId, state.status);
      if (state.status === 'connected') completedConnectedCall = true;
      if (completedConnectedCall && state.status === 'idle' && previousStatus !== 'idle') {
        completedConnectedCall = false;
        void offerCallNotificationsAfterFirstCall().catch(() => undefined);
      }
      previousStatus = state.status;
      previousCallId = state.callId;
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
