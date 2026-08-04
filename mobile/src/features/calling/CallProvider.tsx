import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { AudioPresets, LogLevel, Room, RoomEvent, setLogLevel } from 'livekit-client';

import { authenticatedRequest } from '../../services/api';
import { registerForCallNotifications } from '../../services/notifications';
import { finishPerformance, markPerformance } from '../../services/performance';
import { useAuth } from '../account/AuthProvider';
import { useContacts } from '../contacts/ContactsProvider';
import { useLanguagePreferences } from '../languages/LanguagePreferencesProvider';
import { CallSurfaces } from './CallScreens';
import { friendlyCallMessage } from './callMessages';
import type { CallRecord, CallType, ConnectionStatus, PresenceRecord, PresenceStatus } from './types';

type CallContextValue = {
  cameraEnabled: boolean;
  connectionStatus: ConnectionStatus;
  callMessage: string | null;
  currentCall: CallRecord | null;
  durationSeconds: number;
  frontCamera: boolean;
  history: CallRecord[];
  incomingCall: CallRecord | null;
  muted: boolean;
  room: Room | null;
  speakerEnabled: boolean;
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => Promise<void>;
  enableIncomingNotifications: () => Promise<void>;
  endCall: () => Promise<void>;
  presenceFor: (contactId: string) => PresenceStatus;
  refreshHistory: () => Promise<void>;
  retryCall: () => Promise<void>;
  startCall: (callType: CallType, contact: { emailAddresses: Array<{ value: string }>; phoneNumbers: Array<{ value: string }> }) => Promise<void>;
  switchCamera: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);
const TERMINAL = new Set(['declined', 'ended', 'missed', 'busy', 'failed', 'canceled']);
const MAX_CONNECT_ATTEMPTS = 4;
const CALL_AUDIO_CAPTURE = {
  autoGainControl: true,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  voiceIsolation: { ideal: true },
} as const;

if (!__DEV__) setLogLevel(LogLevel.warn);

export function CallProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { contacts } = useContacts();
  const { languageOne, languageTwo } = useLanguagePreferences();
  const [currentCall, setCurrentCall] = useState<CallRecord | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallRecord | null>(null);
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [presence, setPresence] = useState<Record<string, PresenceStatus>>({});
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const connectionStatusRef = useRef<ConnectionStatus>('idle');
  const [callMessage, setCallMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [frontCamera, setFrontCamera] = useState(true);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const backgroundCamera = useRef(false);
  const disconnectingIntentionally = useRef(false);
  const connectingCallId = useRef<string | null>(null);
  const reconnectAttempts = useRef(0);
  const appState = useRef(AppState.currentState);
  const terminalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateConnectionStatus = useCallback((status: ConnectionStatus) => {
    connectionStatusRef.current = status;
    setConnectionStatus(status);
  }, []);

  const heartbeat = useCallback(async (status: 'available' | 'offline') => {
    if (!user) return;
    await authenticatedRequest('/api/v1/presence/heartbeat', { method: 'POST', body: JSON.stringify({ status }) });
  }, [user]);

  const refreshHistory = useCallback(async () => {
    if (!user) { setHistory([]); return; }
    const result = await authenticatedRequest<{ calls: CallRecord[] }>('/api/v1/calls/history?limit=100');
    setHistory(result.calls);
  }, [user]);

  const refreshIncoming = useCallback(async () => {
    if (!user) return;
    const result = await authenticatedRequest<{ call: CallRecord | null }>('/api/v1/calls/incoming');
    setIncomingCall((existing) => currentCall ? existing : result.call);
  }, [currentCall, user]);

  const disconnectRoom = useCallback(async () => {
    const activeRoom = roomRef.current;
    disconnectingIntentionally.current = true;
    roomRef.current = null;
    setRoom(null);
    if (activeRoom) await activeRoom.disconnect().catch(() => undefined);
    await AudioSession.stopAudioSession().catch(() => undefined);
    updateConnectionStatus('idle');
    setCallMessage(null);
    reconnectAttempts.current = 0;
    connectingCallId.current = null;
    setMuted(false);
    setCameraEnabled(false);
    setSpeakerEnabled(true);
    setFrontCamera(true);
    disconnectingIntentionally.current = false;
  }, [updateConnectionStatus]);

  const connectToCall = useCallback(async (call: CallRecord) => {
    if (roomRef.current || connectingCallId.current === call.id || reconnectAttempts.current >= MAX_CONNECT_ATTEMPTS) return;
    connectingCallId.current = call.id;
    const recovering = reconnectAttempts.current > 0 || ['disconnected', 'reconnecting'].includes(connectionStatusRef.current);
    updateConnectionStatus(recovering ? 'reconnecting' : 'connecting');
    setCallMessage(null);
    markPerformance('call_setup');
    let nextRoom: Room | null = null;
    try {
      const credential = await authenticatedRequest<{ expiresIn: number; livekitUrl: string; token: string }>(`/api/v1/calls/${call.id}/token`, { method: 'POST' });
      await AudioSession.configureAudio({
        android: {
          preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
          audioTypeOptions: { ...AndroidAudioTypePresets.communication, forceHandleAudioRouting: true },
        },
        ios: { defaultOutput: 'speaker' },
      });
      await AudioSession.setDefaultRemoteAudioTrackVolume(1);
      await AudioSession.startAudioSession();
      nextRoom = new Room({
        adaptiveStream: true,
        audioCaptureDefaults: CALL_AUDIO_CAPTURE,
        dynacast: true,
        publishDefaults: { audioPreset: AudioPresets.speech, dtx: true, forceStereo: false, red: true },
      });
    nextRoom.on(RoomEvent.Reconnecting, () => {
      updateConnectionStatus('reconnecting');
      setCallMessage(null);
      void authenticatedRequest(`/api/v1/calls/${call.id}/connection`, { method: 'POST', body: JSON.stringify({ state: 'reconnecting' }) }).catch(() => undefined);
    });
    nextRoom.on(RoomEvent.Reconnected, () => {
      reconnectAttempts.current = 0;
      updateConnectionStatus('connected');
      setCallMessage(null);
      void authenticatedRequest(`/api/v1/calls/${call.id}/connection`, { method: 'POST', body: JSON.stringify({ state: 'reconnected' }) }).catch(() => undefined);
    });
    nextRoom.on(RoomEvent.Disconnected, () => {
      if (disconnectingIntentionally.current || roomRef.current !== nextRoom) return;
      roomRef.current = null;
      setRoom(null);
      reconnectAttempts.current += 1;
      updateConnectionStatus(reconnectAttempts.current >= MAX_CONNECT_ATTEMPTS ? 'failed' : 'disconnected');
      if (reconnectAttempts.current >= MAX_CONNECT_ATTEMPTS) setCallMessage('Unable to connect. Please try again.');
      void AudioSession.stopAudioSession().catch(() => undefined);
    });
    roomRef.current = nextRoom;
    setRoom(nextRoom);
      await nextRoom.connect(credential.livekitUrl, credential.token, { autoSubscribe: false, maxRetries: 3, peerConnectionTimeout: 12_000, websocketTimeout: 12_000 });
      await nextRoom.localParticipant.setMicrophoneEnabled(true, CALL_AUDIO_CAPTURE);
      if (call.callType !== 'voice') {
        await nextRoom.localParticipant.setCameraEnabled(true, { facingMode: 'user' });
        setCameraEnabled(true);
      }
      if (Platform.OS === 'android') await AudioSession.selectAudioOutput('speaker').catch(() => undefined);
      else await AudioSession.selectAudioOutput('force_speaker').catch(() => undefined);
      reconnectAttempts.current = 0;
      updateConnectionStatus('connected');
      finishPerformance('call_setup');
      const result = await authenticatedRequest<{ call: CallRecord }>(`/api/v1/calls/${call.id}/active`, { method: 'POST' });
      setCurrentCall(result.call);
    } catch (error) {
      roomRef.current = null;
      setRoom(null);
      await nextRoom?.disconnect().catch(() => undefined);
      await AudioSession.stopAudioSession().catch(() => undefined);
      reconnectAttempts.current += 1;
      const exhausted = reconnectAttempts.current >= MAX_CONNECT_ATTEMPTS;
      updateConnectionStatus(exhausted ? 'failed' : 'disconnected');
      const message = friendlyCallMessage(error);
      setCallMessage(exhausted ? message : null);
      throw new Error(message);
    } finally {
      connectingCallId.current = null;
    }
  }, [updateConnectionStatus]);

  const startCall = useCallback(async (callType: CallType, contact: { emailAddresses: Array<{ value: string }>; phoneNumbers: Array<{ value: string }> }) => {
    if (currentCall || incomingCall) throw new Error('Finish the current call first.');
    try {
      const result = await authenticatedRequest<{ call: CallRecord }>('/api/v1/calls', {
        method: 'POST',
        body: JSON.stringify({
          contact,
          callType,
          callerSpokenLanguage: languageOne,
          callerHeardLanguage: languageOne,
          calleeSpokenLanguage: languageTwo,
          calleeHeardLanguage: languageTwo,
        }),
      });
      setCurrentCall(result.call);
      reconnectAttempts.current = 0;
      updateConnectionStatus('connecting');
    } catch (error) {
      throw new Error(friendlyCallMessage(error));
    }
  }, [currentCall, incomingCall, languageOne, languageTwo, updateConnectionStatus]);

  const retryCall = useCallback(async () => {
    if (!currentCall) return;
    reconnectAttempts.current = 0;
    setCallMessage(null);
    await connectToCall(currentCall);
  }, [connectToCall, currentCall]);

  const acceptIncoming = useCallback(async () => {
    if (!incomingCall) return;
    const result = await authenticatedRequest<{ call: CallRecord }>(`/api/v1/calls/${incomingCall.id}/accept`, { method: 'POST' });
    setIncomingCall(null);
    setCurrentCall(result.call);
    await connectToCall(result.call);
  }, [connectToCall, incomingCall]);

  const declineIncoming = useCallback(async () => {
    if (!incomingCall) return;
    await authenticatedRequest(`/api/v1/calls/${incomingCall.id}/decline`, { method: 'POST' });
    setIncomingCall(null);
    await refreshHistory().catch(() => undefined);
  }, [incomingCall, refreshHistory]);

  const endCall = useCallback(async () => {
    const call = currentCall;
    if (!call) return;
    await authenticatedRequest(`/api/v1/calls/${call.id}/end`, { method: 'POST' }).catch(() => undefined);
    await disconnectRoom();
    setCurrentCall(null);
    await refreshHistory().catch(() => undefined);
  }, [currentCall, disconnectRoom, refreshHistory]);

  const toggleMute = useCallback(async () => {
    if (!roomRef.current) return;
    const nextMuted = !muted;
    await roomRef.current.localParticipant.setMicrophoneEnabled(!nextMuted);
    setMuted(nextMuted);
  }, [muted]);

  const toggleCamera = useCallback(async () => {
    if (!roomRef.current || currentCall?.callType === 'voice') return;
    const nextEnabled = !cameraEnabled;
    await roomRef.current.localParticipant.setCameraEnabled(nextEnabled, nextEnabled ? { facingMode: frontCamera ? 'user' : 'environment' } : undefined);
    setCameraEnabled(nextEnabled);
  }, [cameraEnabled, currentCall?.callType, frontCamera]);

  const switchCamera = useCallback(async () => {
    if (!roomRef.current || currentCall?.callType === 'voice') return;
    const nextFront = !frontCamera;
    await roomRef.current.localParticipant.setCameraEnabled(false);
    await roomRef.current.localParticipant.setCameraEnabled(true, { facingMode: nextFront ? 'user' : 'environment' });
    setFrontCamera(nextFront);
    setCameraEnabled(true);
  }, [currentCall?.callType, frontCamera]);

  const toggleSpeaker = useCallback(async () => {
    const nextEnabled = !speakerEnabled;
    const output = Platform.OS === 'android' ? (nextEnabled ? 'speaker' : 'earpiece') : (nextEnabled ? 'force_speaker' : 'default');
    await AudioSession.selectAudioOutput(output);
    setSpeakerEnabled(nextEnabled);
  }, [speakerEnabled]);

  const enableIncomingNotifications = useCallback(async () => {
    await registerForCallNotifications(true);
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }
    void heartbeat('available').catch(() => undefined);
    void registerForCallNotifications(false).catch(() => undefined);
    void refreshHistory().catch(() => undefined);
    void refreshIncoming().catch(() => undefined);
    const heartbeatTimer = setInterval(() => { if (appState.current === 'active') void heartbeat('available').catch(() => undefined); }, 25_000);
    const incomingTimer = setInterval(() => { if (appState.current === 'active') void refreshIncoming().catch(() => undefined); }, 6_000);
    return () => { clearInterval(heartbeatTimer); clearInterval(incomingTimer); };
  }, [disconnectRoom, heartbeat, refreshHistory, refreshIncoming, user]);

  useEffect(() => {
    if (!user || !contacts.length) { setPresence({}); return; }
    const refreshPresence = async () => {
      const ids = contacts.map((contact) => contact.id).join(',');
      const result = await authenticatedRequest<{ presence: PresenceRecord[] }>(`/api/v1/presence?contactIds=${encodeURIComponent(ids)}`);
      setPresence(Object.fromEntries(result.presence.map((item) => [item.userId, item.status])));
    };
    void refreshPresence().catch(() => undefined);
    const timer = setInterval(() => { if (appState.current === 'active') void refreshPresence().catch(() => undefined); }, 20_000);
    return () => clearInterval(timer);
  }, [contacts, user]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => void refreshIncoming().catch(() => undefined));
    const response = Notifications.addNotificationResponseReceivedListener((event) => {
      const data = event.notification.request.content.data;
      if (event.actionIdentifier === 'decline' && typeof data.callId === 'string') {
        void authenticatedRequest(`/api/v1/calls/${data.callId}/decline`, { method: 'POST' }).then(() => setIncomingCall(null)).catch(() => undefined);
      } else if (event.actionIdentifier === 'accept' && typeof data.callId === 'string') {
        void authenticatedRequest<{ call: CallRecord }>(`/api/v1/calls/${data.callId}/accept`, { method: 'POST' }).then(async ({ call }) => {
          setIncomingCall(null);
          setCurrentCall(call);
          await connectToCall(call);
        }).catch(() => refreshIncoming());
      } else void refreshIncoming().catch(() => undefined);
    });
    return () => { received.remove(); response.remove(); };
  }, [connectToCall, refreshIncoming]);

  useEffect(() => {
    if (!currentCall) return;
    const poll = async () => {
      const result = await authenticatedRequest<{ call: CallRecord }>(`/api/v1/calls/${currentCall.id}`);
      setCurrentCall(result.call);
      if (['accepted', 'active'].includes(result.call.status) && !roomRef.current) await connectToCall(result.call);
      if (TERMINAL.has(result.call.status)) {
        await disconnectRoom();
        if (terminalTimer.current) clearTimeout(terminalTimer.current);
        terminalTimer.current = setTimeout(() => setCurrentCall(null), 1200);
        await refreshHistory().catch(() => undefined);
      }
    };
    void poll().catch(() => undefined);
    const timer = setInterval(() => void poll().catch(() => undefined), 2_000);
    return () => clearInterval(timer);
  }, [connectToCall, currentCall?.id, disconnectRoom, refreshHistory]);

  useEffect(() => {
    if (!currentCall?.answeredAt) { setDurationSeconds(0); return; }
    const update = () => setDurationSeconds(Math.max(0, Math.floor((Date.now() - new Date(currentCall.answeredAt!).getTime()) / 1000)));
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [currentCall?.answeredAt]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appState.current = state;
      void heartbeat(state === 'active' ? 'available' : 'offline').catch(() => undefined);
      if (state !== 'active' && cameraEnabled && roomRef.current) {
        backgroundCamera.current = true;
        void roomRef.current.localParticipant.setCameraEnabled(false).then(() => setCameraEnabled(false));
      } else if (state === 'active' && backgroundCamera.current && roomRef.current) {
        backgroundCamera.current = false;
        void roomRef.current.localParticipant.setCameraEnabled(true, { facingMode: frontCamera ? 'user' : 'environment' }).then(() => setCameraEnabled(true));
      }
      if (state === 'active' && roomRef.current) {
        void AudioSession.startAudioSession()
          .then(() => AudioSession.selectAudioOutput(speakerEnabled ? (Platform.OS === 'android' ? 'speaker' : 'force_speaker') : (Platform.OS === 'android' ? 'earpiece' : 'default')))
          .catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [cameraEnabled, frontCamera, heartbeat, speakerEnabled]);

  useEffect(() => () => {
    if (terminalTimer.current) clearTimeout(terminalTimer.current);
  }, []);

  const value = useMemo<CallContextValue>(() => ({
    callMessage, cameraEnabled, connectionStatus, currentCall, durationSeconds, frontCamera, history, incomingCall, muted, room, speakerEnabled,
    acceptIncoming, declineIncoming, enableIncomingNotifications, endCall,
    presenceFor(contactId) {
      const contact = contacts.find((item) => item.id === contactId);
      return contact?.interpreterUserId ? presence[contact.interpreterUserId] || 'offline' : 'offline';
    },
    refreshHistory, retryCall, startCall, switchCamera, toggleCamera, toggleMute, toggleSpeaker,
  }), [acceptIncoming, callMessage, cameraEnabled, connectionStatus, contacts, currentCall, declineIncoming, durationSeconds, enableIncomingNotifications, endCall, frontCamera, history, incomingCall, muted, presence, refreshHistory, retryCall, room, speakerEnabled, startCall, switchCamera, toggleCamera, toggleMute, toggleSpeaker]);

  return <CallContext.Provider value={value}>{children}<CallSurfaces /></CallContext.Provider>;
}

export function useCalling() {
  const value = useContext(CallContext);
  if (!value) throw new Error('useCalling must be used inside CallProvider.');
  return value;
}
