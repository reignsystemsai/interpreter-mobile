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

export type TranscriptTurn = {
  id: string;
  original: string;
  originalLanguage: string;
  translation: string;
  translationLanguage: string;
};

type InterpreterStatus =
  | 'idle'
  | 'connecting'
  | 'detecting'
  | 'listening'
  | 'translating'
  | 'speaking'
  | 'error';

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

export function useRealtimeInterpreter(selectedLanguage: string) {
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
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<(() => Promise<void>) | null>(null);

  const routeAudioToSpeaker = useCallback(() => {
    InCallManager.start({ auto: true, media: 'audio' });
    InCallManager.setForceSpeakerphoneOn(true);
    InCallManager.setSpeakerphoneOn(true);
  }, []);

  const setMicrophoneEnabled = useCallback((enabled: boolean) => {
    const microphoneTrack = localStreamRef.current?.getAudioTracks()[0];
    if (microphoneTrack) microphoneTrack.enabled = enabled;
  }, []);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    reconnectAttemptsRef.current = 0;
    startingRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    if (echoResumeTimerRef.current) clearTimeout(echoResumeTimerRef.current);
    echoResumeTimerRef.current = null;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteAudioTrackRef.current?.stop();
    remoteAudioTrackRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    currentTurnIdRef.current = null;
    translationBufferRef.current = '';
    outputAudioActiveRef.current = false;
    replayingRef.current = false;
    InCallManager.setForceSpeakerphoneOn(null);
    InCallManager.stop();
    setStatus('idle');
    setIsMuted(false);
    userMutedRef.current = false;
  }, []);

  const scheduleReconnect = useCallback((message: string) => {
    if (manualStopRef.current || reconnectTimerRef.current) return;
    if (reconnectAttemptsRef.current >= 3) {
      setErrorMessage('Unable to reconnect. End the conversation and start again.');
      setStatus('error');
      return;
    }
    const nextAttempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = nextAttempt;
    setErrorMessage(message);
    setStatus('error');
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      stop();
      reconnectAttemptsRef.current = nextAttempt;
      manualStopRef.current = false;
      void startRef.current?.();
    }, 1500);
  }, [stop]);

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

  const start = useCallback(async () => {
    if (startingRef.current) return;
    if (peerConnectionRef.current) stop();
    manualStopRef.current = false;
    startingRef.current = true;
    setErrorMessage(null);
    setTurns([]);
    setDetectedUserLanguage(null);
    detectedUserLanguageRef.current = null;
    currentTurnIdRef.current = null;
    translationBufferRef.current = '';
    setStatus('connecting');

    try {
      if (Platform.OS === 'android') {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone access',
            message: 'Interpreter.ai needs the microphone to interpret live speech.',
            buttonPositive: 'Continue',
            buttonNegative: 'Cancel',
          },
        );
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          throw new Error('Microphone permission was not granted.');
        }
      }

      const localStream = await mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = localStream;
      debugLog('Microphone ready');
      routeAudioToSpeaker();

      const sessionResponse = await fetch(`${getApiBaseUrl()}/api/realtime/session`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          languageOne: 'Auto-detect',
          languageTwo: selectedLanguage,
          mode: 'mobile-interpreter',
        }),
      });
      const sessionPayload = await sessionResponse.text();
      if (!sessionResponse.ok) {
        throw new Error(
          formatRequestError(sessionPayload) || `Session request failed (${sessionResponse.status}).`,
        );
      }
      const clientSecret = (JSON.parse(sessionPayload) as ClientSecretResponse).value;
      if (!clientSecret) throw new Error('The server did not return a Realtime credential.');

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;
      peerConnection.ontrack = (event: unknown) => {
        const remoteTrack = (event as RemoteTrackEvent).track;
        if (!remoteTrack || remoteTrack.kind !== 'audio') {
          setErrorMessage('OpenAI connected without a playable audio track.');
          setStatus('error');
          return;
        }
        remoteAudioTrackRef.current = remoteTrack;
        remoteTrack.enabled = true;
        remoteTrack._setVolume(1);
        routeAudioToSpeaker();
      };

      const microphoneTrack = localStream.getAudioTracks()[0];
      if (!microphoneTrack) throw new Error('No microphone audio track is available.');
      peerConnection.addTrack(microphoneTrack, localStream);
      peerConnection.onconnectionstatechange = () => {
        debugLog('Peer state', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
          reconnectAttemptsRef.current = 0;
          setErrorMessage(null);
          setStatus('listening');
        }
        if (
          peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'disconnected'
        ) {
          scheduleReconnect('The Realtime audio connection was interrupted. Reconnecting automatically.');
        }
      };

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () => setStatus('listening');
      dataChannel.onclose = () => {
        scheduleReconnect('The OpenAI connection closed. Reconnecting automatically.');
      };
      dataChannel.onerror = () => {
        scheduleReconnect('The OpenAI connection was interrupted. Reconnecting automatically.');
      };
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
              selectedLanguage,
              detectedUserLanguageRef.current,
            );
            if (
              !detectedUserLanguageRef.current &&
              originalLanguage !== selectedLanguage &&
              originalLanguage !== 'Detected language'
            ) {
              detectedUserLanguageRef.current = originalLanguage;
              setDetectedUserLanguage(originalLanguage);
            }
            const id = realtimeEvent.item_id ?? `turn-${Date.now()}`;
            currentTurnIdRef.current = id;
            const translationLanguage =
              originalLanguage === selectedLanguage
                ? detectedUserLanguageRef.current ?? 'Detected language'
                : selectedLanguage;
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
              setErrorMessage(formatRealtimeResponseError(realtimeEvent));
              setStatus('error');
            }
          } else if (realtimeEvent.type === 'error') {
            setErrorMessage(realtimeEvent.error?.message ?? 'OpenAI returned an error.');
            setStatus('error');
          }
        } catch (error) {
          debugError('Realtime event parsing error', error);
          setErrorMessage('Unable to read a Realtime event. Tap Reconnect.');
          setStatus('error');
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const offerSdp = peerConnection.localDescription?.sdp ?? offer.sdp;
      if (!offerSdp) throw new Error('Unable to create the Realtime audio offer.');
      const sdpResponse = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
        body: offerSdp,
      });
      const answerSdp = await sdpResponse.text();
      if (!sdpResponse.ok) {
        throw new Error(answerSdp || `Realtime connection failed (${sdpResponse.status}).`);
      }
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription({ sdp: answerSdp, type: 'answer' }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start interpreting.';
      debugError('Connection error', error);
      dataChannelRef.current?.close();
      dataChannelRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      remoteAudioTrackRef.current?.stop();
      remoteAudioTrackRef.current = null;
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
      InCallManager.setForceSpeakerphoneOn(null);
      InCallManager.stop();
      setErrorMessage(message);
      setStatus('error');
    } finally {
      startingRef.current = false;
    }
  }, [
    selectedLanguage,
    routeAudioToSpeaker,
    scheduleReconnect,
    setMicrophoneEnabled,
    stop,
    updateTranslation,
  ]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => stop, [stop]);

  return {
    detectedUserLanguage,
    errorMessage,
    isActive: status !== 'idle' && status !== 'error',
    isMuted,
    replayLastTranslation,
    start,
    status,
    stop,
    toggleMute,
    turns,
  };
}
