import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStreamTrack,
} from 'react-native-webrtc';

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const PRODUCTION_API_BASE_URL = 'https://interpreter-api-fycw.onrender.com';
const SESSION_REQUEST_TIMEOUT_MS = 60_000;
const WEBRTC_NEGOTIATION_TIMEOUT_MS = 20_000;
const DATA_CHANNEL_TIMEOUT_MS = 20_000;
const REMOTE_AUDIO_TRACK_TIMEOUT_MS = 12_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const SPEECH_DETECTION_UPDATE = JSON.stringify({
  type: 'session.update',
  session: {
    type: 'realtime',
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.65,
          prefix_padding_ms: 300,
          silence_duration_ms: 700,
          create_response: true,
          interrupt_response: true,
        },
      },
    },
  },
});

export type TranscriptTurn = {
  id: string;
  original: string;
  originalLanguage: string;
  translation: string;
  translationLanguage: string;
};

type InterpreterStatus =
  | 'idle'
  | 'requesting_permission'
  | 'creating_session'
  | 'connecting'
  | 'connected'
  | 'detecting'
  | 'listening'
  | 'translating'
  | 'speaking'
  | 'reconnecting'
  | 'disconnected'
  | 'failed'
  | 'stopping';

type ConnectionDiagnosticCode =
  | 'microphone_denied'
  | 'microphone_unavailable'
  | 'backend_unavailable'
  | 'session_timeout'
  | 'session_invalid'
  | 'webrtc_offer_failed'
  | 'webrtc_negotiation_timeout'
  | 'webrtc_negotiation_failed'
  | 'data_channel_timeout'
  | 'data_channel_closed'
  | 'audio_track_timeout'
  | 'realtime_error'
  | 'network_offline'
  | 'unknown';

class InterpreterConnectionError extends Error {
  constructor(readonly code: ConnectionDiagnosticCode, message?: string) {
    super(message ?? code);
    this.name = 'InterpreterConnectionError';
  }
}

function diagnosticCode(error: unknown): ConnectionDiagnosticCode {
  if (error instanceof InterpreterConnectionError) return error.code;
  if (error instanceof TypeError) return 'network_offline';
  return 'unknown';
}

function friendlyConnectionMessage(code: ConnectionDiagnosticCode) {
  if (code === 'microphone_denied') return 'Interpreter needs microphone access to start a conversation.';
  if (code === 'network_offline') return 'You appear to be offline.';
  if (code === 'session_timeout' || code === 'webrtc_negotiation_timeout' || code === 'data_channel_timeout' || code === 'audio_track_timeout') return 'The connection took too long. Please try again.';
  if (code === 'backend_unavailable' || code === 'session_invalid') return 'Interpreter is temporarily unavailable.';
  return 'Interpreter could not connect. Please try again.';
}

function waitFor<T>(promise: Promise<T>, timeoutMs: number, code: ConnectionDiagnosticCode) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new InterpreterConnectionError(code)), timeoutMs);
    promise.then((value) => { clearTimeout(timeout); resolve(value); }, (error) => { clearTimeout(timeout); reject(error); });
  });
}

type ClientSecretResponse = {
  value?: string;
  details?: unknown;
  error?: string;
};

type RealtimeEvent = {
  delta?: string;
  item_id?: string;
  type?: string;
  error?: { message?: string };
  response?: {
    id?: string;
    status?: string;
    status_details?: unknown;
  };
  transcript?: string;
};

type RemoteTrackEvent = {
  streams?: MediaStream[];
  track?: MediaStreamTrack | null;
};

function debugLog(...values: unknown[]) {
  if (__DEV__) console.log('[Interpreter.ai]', ...values);
}

function debugError(...values: unknown[]) {
  if (__DEV__) console.error('[Interpreter.ai]', ...values);
}

function getApiBaseUrl() {
  return (
    process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '') ||
    PRODUCTION_API_BASE_URL
  );
}

function formatRequestError(payload: string) {
  try {
    const parsed = JSON.parse(payload) as ClientSecretResponse;
    if (parsed.details && typeof parsed.details === 'object') {
      const detailsError =
        'error' in parsed.details ? parsed.details.error : undefined;
      if (
        detailsError &&
        typeof detailsError === 'object' &&
        'message' in detailsError &&
        typeof detailsError.message === 'string'
      ) {
        return detailsError.message;
      }
    }
    return parsed.error ?? payload;
  } catch {
    return payload;
  }
}

function formatRealtimeResponseError(event: RealtimeEvent) {
  const status = event.response?.status ?? 'unknown';
  const details = event.response?.status_details;
  if (details && typeof details === 'object') {
    const error = 'error' in details ? details.error : undefined;
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message;
    }
    if (
      'reason' in details &&
      typeof details.reason === 'string' &&
      details.reason.length > 0
    ) {
      return details.reason;
    }
  }
  return `OpenAI Realtime response ended with status: ${status}.`;
}

function detectLatinLanguage(text: string) {
  const normalized = ` ${text.toLocaleLowerCase()} `;
  const scores: Record<string, number> = {
    English: 0,
    French: 0,
    German: 0,
    Italian: 0,
    Spanish: 0,
    'Brazilian Portuguese': 0,
  };
  const markers: Record<string, string[]> = {
    English: [' the ', ' and ', ' is ', ' are ', ' where ', ' what ', ' please ', ' hello '],
    French: [' le ', ' la ', ' les ', ' est ', ' où ', ' vous ', ' je ', ' merci ', ' une '],
    German: [' der ', ' die ', ' das ', ' ist ', ' und ', ' wo ', ' ich ', ' bitte ', ' ein '],
    Italian: [' il ', ' lo ', ' la ', ' gli ', ' è ', ' dove ', ' io ', ' grazie ', ' una '],
    Spanish: [' el ', ' la ', ' los ', ' es ', ' dónde ', ' usted ', ' yo ', ' gracias ', ' una '],
    'Brazilian Portuguese': [' o ', ' a ', ' os ', ' é ', ' onde ', ' você ', ' eu ', ' obrigado ', ' uma ', ' não '],
  };
  Object.entries(markers).forEach(([language, words]) => {
    words.forEach((word) => {
      if (normalized.includes(word)) scores[language] = (scores[language] ?? 0) + 1;
    });
  });
  if (/[ãõç]/i.test(text)) scores['Brazilian Portuguese'] = (scores['Brazilian Portuguese'] ?? 0) + 3;
  if (/[¿¡ñ]/i.test(text)) scores.Spanish = (scores.Spanish ?? 0) + 3;
  if (/[œ]/i.test(text)) scores.French = (scores.French ?? 0) + 3;
  if (/[äöüß]/i.test(text)) scores.German = (scores.German ?? 0) + 3;
  return Object.entries(scores).sort((left, right) => right[1] - left[1])[0];
}

function detectSpokenLanguage(
  text: string,
  selectedLanguage: string,
  retainedLanguage: string | null,
) {
  if (/[\u3040-\u30ff]/u.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/u.test(text)) return 'Korean';
  if (/[\u0600-\u06ff]/u.test(text)) return 'Arabic';
  if (/[\u0900-\u097f]/u.test(text)) return 'Hindi';
  if (/[\u3400-\u9fff]/u.test(text)) return 'Mandarin Chinese';

  const detected = detectLatinLanguage(text);
  if (detected && detected[1] > 0) return detected[0];
  return retainedLanguage ?? (selectedLanguage === 'English' ? 'Detected language' : 'English');
}

export function useRealtimeInterpreter(languageOne: string, languageTwo: string) {
  const [status, setStatus] = useState<InterpreterStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [detectedUserLanguage, setDetectedUserLanguage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<ReturnType<RTCPeerConnection['createDataChannel']> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const currentTurnIdRef = useRef<string | null>(null);
  const translationBufferRef = useRef('');
  const detectedUserLanguageRef = useRef<string | null>(null);
  const echoResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputAudioActiveRef = useRef(false);
  const userMutedRef = useRef(false);
  const replayingRef = useRef(false);
  const startingRef = useRef(false);
  const manualStopRef = useRef(true);
  const hasConnectedOnceRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const attemptIdRef = useRef(0);
  const connectRef = useRef<((reconnecting: boolean) => Promise<void>) | null>(null);
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnosticCode | null>(null);

  const routeAudioToSpeaker = useCallback(() => {
    InCallManager.start({ auto: true, media: 'audio' });
    InCallManager.setForceSpeakerphoneOn(true);
    InCallManager.setSpeakerphoneOn(true);
  }, []);

  const setMicrophoneEnabled = useCallback((enabled: boolean) => {
    const microphoneTrack = localStreamRef.current?.getAudioTracks()[0];
    if (microphoneTrack) microphoneTrack.enabled = enabled;
  }, []);

  const cleanupTransport = useCallback(() => {
    attemptIdRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    if (echoResumeTimerRef.current) clearTimeout(echoResumeTimerRef.current);
    echoResumeTimerRef.current = null;
    if (dataChannelRef.current) {
      dataChannelRef.current.onopen = null;
      dataChannelRef.current.onclose = null;
      dataChannelRef.current.onerror = null;
      dataChannelRef.current.onmessage = null;
      dataChannelRef.current.close();
    }
    dataChannelRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteAudioTrackRef.current?.stop();
    remoteAudioTrackRef.current = null;
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
    }
    peerConnectionRef.current = null;
    currentTurnIdRef.current = null;
    translationBufferRef.current = '';
    outputAudioActiveRef.current = false;
    replayingRef.current = false;
    InCallManager.setForceSpeakerphoneOn(null);
    InCallManager.stop();
    setIsMuted(false);
    userMutedRef.current = false;
  }, []);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    startingRef.current = false;
    hasConnectedOnceRef.current = false;
    reconnectAttemptsRef.current = 0;
    setStatus('stopping');
    cleanupTransport();
    setErrorMessage(null);
    setDiagnostic(null);
    setStatus('idle');
  }, [cleanupTransport]);

  const scheduleReconnect = useCallback((code: ConnectionDiagnosticCode) => {
    if (manualStopRef.current || reconnectTimerRef.current) return;
    if (!hasConnectedOnceRef.current) {
      cleanupTransport();
      setDiagnostic(code);
      setErrorMessage(friendlyConnectionMessage(code));
      setStatus('failed');
      return;
    }
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      cleanupTransport();
      hasConnectedOnceRef.current = false;
      setDiagnostic(code);
      setErrorMessage('Interpreter could not reconnect. Please try again.');
      setStatus('failed');
      return;
    }
    const nextAttempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = nextAttempt;
    setErrorMessage(null);
    setStatus('reconnecting');
    cleanupTransport();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!manualStopRef.current) void connectRef.current?.(true);
    }, 1500);
  }, [cleanupTransport]);

  const toggleMute = useCallback(() => {
    const nextMuted = !userMutedRef.current;
    userMutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    setMicrophoneEnabled(!nextMuted && !outputAudioActiveRef.current);
  }, [setMicrophoneEnabled]);

  const replayLastTranslation = useCallback(() => {
    const latestTranslation = [...turns].reverse().find((turn) => turn.translation)?.translation;
    const dataChannel = dataChannelRef.current;
    if (!latestTranslation || !dataChannel || dataChannel.readyState !== 'open') return;
    replayingRef.current = true;
    dataChannel.send(
      JSON.stringify({
        type: 'response.create',
        response: {
          instructions: `Speak exactly this prior translation again, with no preface or commentary: ${latestTranslation}`,
          output_modalities: ['audio'],
        },
      }),
    );
  }, [turns]);

  const updateTranslation = useCallback((text: string) => {
    const turnId = currentTurnIdRef.current;
    if (!turnId || replayingRef.current) return;
    setTurns((current) =>
      current.map((turn) =>
        turn.id === turnId ? { ...turn, translation: text.trim() } : turn,
      ),
    );
  }, []);

  const connect = useCallback(async (reconnecting: boolean) => {
    if (startingRef.current) return;
    if (!reconnecting) {
      cleanupTransport();
      hasConnectedOnceRef.current = false;
      reconnectAttemptsRef.current = 0;
      setTurns([]);
      setDetectedUserLanguage(null);
      detectedUserLanguageRef.current = null;
      currentTurnIdRef.current = null;
      translationBufferRef.current = '';
    }
    manualStopRef.current = false;
    startingRef.current = true;
    setErrorMessage(null);
    setDiagnostic(null);
    const attemptId = ++attemptIdRef.current;
    setStatus(reconnecting ? 'reconnecting' : 'requesting_permission');

    try {
      if (Platform.OS === 'android') {
        const alreadyGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        const permission = alreadyGranted ? PermissionsAndroid.RESULTS.GRANTED : await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          { title: 'Microphone access', message: 'Interpreter.ai needs the microphone to interpret live speech.', buttonPositive: 'Continue', buttonNegative: 'Cancel' },
        );
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          throw new InterpreterConnectionError('microphone_denied');
        }
      }

      const localStream = await waitFor<MediaStream>(
        mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true }, video: false }) as Promise<MediaStream>,
        WEBRTC_NEGOTIATION_TIMEOUT_MS,
        'microphone_unavailable',
      );
      if (attemptId !== attemptIdRef.current || manualStopRef.current) { localStream.getTracks().forEach((track) => track.stop()); return; }
      localStreamRef.current = localStream;
      debugLog('Connection stage', { code: 'microphone_ready' });
      routeAudioToSpeaker();

      setStatus(reconnecting ? 'reconnecting' : 'creating_session');
      const requestController = new AbortController();
      requestAbortRef.current = requestController;
      const sessionResponse = await waitFor(fetch(`${getApiBaseUrl()}/api/realtime/session`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        signal: requestController.signal,
        body: JSON.stringify({
          languageOne,
          languageTwo,
          mode: 'mobile-pair',
        }),
      }), SESSION_REQUEST_TIMEOUT_MS, 'session_timeout');
      requestAbortRef.current = null;
      const sessionPayload = await sessionResponse.text();
      if (!sessionResponse.ok) {
        debugError('Connection stage failed', { code: 'backend_unavailable', status: sessionResponse.status });
        throw new InterpreterConnectionError('backend_unavailable', formatRequestError(sessionPayload));
      }
      let clientSecret: string | undefined;
      try { clientSecret = (JSON.parse(sessionPayload) as ClientSecretResponse).value; } catch { throw new InterpreterConnectionError('session_invalid'); }
      if (!clientSecret) throw new InterpreterConnectionError('session_invalid');
      debugLog('Connection stage', { code: 'session_ready' });
      setStatus(reconnecting ? 'reconnecting' : 'connecting');

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;
      let resolveRemoteAudio: (() => void) | null = null;
      const remoteAudioReady = new Promise<void>((resolve) => { resolveRemoteAudio = resolve; });
      peerConnection.ontrack = (event: unknown) => {
        const remoteTrack = (event as RemoteTrackEvent).track;
        if (!remoteTrack || remoteTrack.kind !== 'audio') return;
        remoteAudioTrackRef.current = remoteTrack;
        remoteTrack.enabled = true;
        remoteTrack._setVolume(1);
        routeAudioToSpeaker();
        resolveRemoteAudio?.();
      };

      const microphoneTrack = localStream.getAudioTracks()[0];
      if (!microphoneTrack) throw new InterpreterConnectionError('microphone_unavailable');
      peerConnection.addTrack(microphoneTrack, localStream);
      let rejectChannelOpen: ((error: Error) => void) | null = null;
      peerConnection.onconnectionstatechange = () => {
        if (attemptId !== attemptIdRef.current) return;
        debugLog('Connection stage', { code: `peer_${peerConnection.connectionState}` });
        if (
          peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'disconnected'
        ) {
          const connectionError = new InterpreterConnectionError('webrtc_negotiation_failed');
          if (!hasConnectedOnceRef.current) rejectChannelOpen?.(connectionError);
          else scheduleReconnect('webrtc_negotiation_failed');
        }
      };

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      const channelOpened = new Promise<void>((resolve, reject) => {
        rejectChannelOpen = reject;
        dataChannel.onopen = () => {
          dataChannel.send(SPEECH_DETECTION_UPDATE);
          resolve();
        };
        dataChannel.onclose = () => reject(new InterpreterConnectionError('data_channel_closed'));
        dataChannel.onerror = () => reject(new InterpreterConnectionError('realtime_error'));
      });
      dataChannel.onmessage = (event: { data?: unknown }) => {
        try {
          const realtimeEvent = JSON.parse(String(event.data)) as RealtimeEvent;
          debugLog('Realtime event', realtimeEvent.type ?? 'unknown');

          if (realtimeEvent.type === 'input_audio_buffer.speech_started') {
            setStatus('detecting');
          } else if (realtimeEvent.type === 'input_audio_buffer.speech_stopped') {
            setStatus('translating');
          } else if (
            realtimeEvent.type === 'conversation.item.input_audio_transcription.completed'
          ) {
            const original = realtimeEvent.transcript?.trim();
            if (!original) return;
            const originalLanguage = detectSpokenLanguage(
              original,
              languageTwo,
              detectedUserLanguageRef.current,
            );
            if (
              !detectedUserLanguageRef.current &&
              originalLanguage !== languageTwo &&
              originalLanguage !== 'Detected language'
            ) {
              detectedUserLanguageRef.current = originalLanguage;
              setDetectedUserLanguage(originalLanguage);
            }
            const id = realtimeEvent.item_id ?? `turn-${Date.now()}`;
            currentTurnIdRef.current = id;
            const translationLanguage =
              originalLanguage === languageTwo
                ? detectedUserLanguageRef.current ?? 'Detected language'
                : languageTwo;
            setTurns((current) => [
              ...current.slice(-19),
              {
                id,
                original,
                originalLanguage,
                translation: translationBufferRef.current.trim(),
                translationLanguage,
              },
            ]);
          } else if (realtimeEvent.type === 'response.created') {
            translationBufferRef.current = '';
            setStatus('translating');
          } else if (
            realtimeEvent.type === 'output_audio_buffer.started' ||
            realtimeEvent.type === 'response.output_audio.delta'
          ) {
            outputAudioActiveRef.current = true;
            setMicrophoneEnabled(false);
            setStatus('speaking');
          } else if (realtimeEvent.type === 'response.output_audio_transcript.delta') {
            translationBufferRef.current = (
              translationBufferRef.current + (realtimeEvent.delta ?? '')
            ).slice(-1200);
            updateTranslation(translationBufferRef.current);
          } else if (realtimeEvent.type === 'response.output_audio_transcript.done') {
            translationBufferRef.current =
              realtimeEvent.transcript ?? translationBufferRef.current;
            updateTranslation(translationBufferRef.current);
          } else if (
            realtimeEvent.type === 'output_audio_buffer.stopped' ||
            realtimeEvent.type === 'output_audio_buffer.cleared'
          ) {
            outputAudioActiveRef.current = false;
            replayingRef.current = false;
            if (echoResumeTimerRef.current) clearTimeout(echoResumeTimerRef.current);
            echoResumeTimerRef.current = setTimeout(() => {
              setMicrophoneEnabled(!userMutedRef.current);
              echoResumeTimerRef.current = null;
              setStatus('listening');
            }, 550);
          } else if (realtimeEvent.type === 'response.done') {
            if (
              realtimeEvent.response?.status === 'failed' ||
              realtimeEvent.response?.status === 'incomplete'
            ) {
              debugError('Realtime response failed', { code: 'realtime_error', detail: formatRealtimeResponseError(realtimeEvent) ? 'available' : 'missing' });
              scheduleReconnect('realtime_error');
            }
          } else if (realtimeEvent.type === 'error') {
            debugError('Realtime event failed', { code: 'realtime_error', detail: realtimeEvent.error?.message ? 'available' : 'missing' });
            scheduleReconnect('realtime_error');
          }
        } catch (error) {
          debugError('Realtime event parsing error', { code: 'realtime_error' });
          scheduleReconnect('realtime_error');
        }
      };

      const offer: any = await waitFor(peerConnection.createOffer() as Promise<any>, WEBRTC_NEGOTIATION_TIMEOUT_MS, 'webrtc_offer_failed');
      await waitFor(peerConnection.setLocalDescription(offer), WEBRTC_NEGOTIATION_TIMEOUT_MS, 'webrtc_offer_failed');
      const offerSdp = peerConnection.localDescription?.sdp ?? offer.sdp;
      if (!offerSdp) throw new InterpreterConnectionError('webrtc_offer_failed');
      const sdpController = new AbortController();
      requestAbortRef.current = sdpController;
      const sdpResponse = await waitFor(fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
        signal: sdpController.signal,
        body: offerSdp,
      }), WEBRTC_NEGOTIATION_TIMEOUT_MS, 'webrtc_negotiation_timeout');
      requestAbortRef.current = null;
      const answerSdp = await sdpResponse.text();
      if (!sdpResponse.ok) {
        debugError('Connection stage failed', { code: 'webrtc_negotiation_failed', status: sdpResponse.status });
        throw new InterpreterConnectionError('webrtc_negotiation_failed');
      }
      await waitFor(
        peerConnection.setRemoteDescription(new RTCSessionDescription({ sdp: answerSdp, type: 'answer' })),
        WEBRTC_NEGOTIATION_TIMEOUT_MS,
        'webrtc_negotiation_timeout',
      );
      await Promise.all([
        waitFor(channelOpened, DATA_CHANNEL_TIMEOUT_MS, 'data_channel_timeout'),
        waitFor(remoteAudioReady, REMOTE_AUDIO_TRACK_TIMEOUT_MS, 'audio_track_timeout'),
      ]);
      if (attemptId !== attemptIdRef.current || manualStopRef.current) return;
      hasConnectedOnceRef.current = true;
      reconnectAttemptsRef.current = 0;
      setErrorMessage(null);
      setDiagnostic(null);
      setStatus('connected');
      dataChannel.onclose = () => scheduleReconnect('data_channel_closed');
      dataChannel.onerror = () => scheduleReconnect('realtime_error');
      setStatus('listening');
      debugLog('Connection stage', { code: 'data_channel_open' });
    } catch (error) {
      if (attemptId !== attemptIdRef.current || manualStopRef.current) return;
      const code = diagnosticCode(error);
      debugError('Connection attempt failed', { code, phase: reconnecting ? 'reconnect' : 'initial' });
      cleanupTransport();
      setDiagnostic(code);
      if (reconnecting) scheduleReconnect(code);
      else {
        hasConnectedOnceRef.current = false;
        setErrorMessage(friendlyConnectionMessage(code));
        setStatus('failed');
      }
    } finally {
      startingRef.current = false;
    }
  }, [
    cleanupTransport,
    languageOne,
    languageTwo,
    routeAudioToSpeaker,
    scheduleReconnect,
    setMicrophoneEnabled,
    updateTranslation,
  ]);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    await connect(false);
  }, [connect]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => stop, [stop]);

  return {
    detectedUserLanguage,
    diagnosticCode: diagnostic,
    errorMessage,
    isActive: !['idle', 'failed', 'stopping'].includes(status),
    isMuted,
    replayLastTranslation,
    start,
    status,
    stop,
    toggleMute,
    turns,
  };
}
