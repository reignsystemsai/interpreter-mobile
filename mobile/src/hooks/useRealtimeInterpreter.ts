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

export type RealtimeMode = 'browser-two-way' | 'companion';

type InterpreterStatus =
  | 'idle'
  | 'connecting'
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
  type?: string;
  error?: {
    message?: string;
  };
  response?: {
    status?: string;
    status_details?: unknown;
  };
  transcript?: string;
};

type RemoteTrackEvent = {
  streams?: MediaStream[];
  track?: MediaStreamTrack | null;
};

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

export function useRealtimeInterpreter(
  languageOne: string,
  languageTwo: string,
  mode: RealtimeMode = 'browser-two-way',
) {
  const [status, setStatus] = useState<InterpreterStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diagnosticMessage, setDiagnosticMessage] = useState<string | null>(
    null,
  );
  const [transcript, setTranscript] = useState<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<
    ReturnType<RTCPeerConnection['createDataChannel']> | null
  >(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const transcriptBufferRef = useRef('');
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const echoResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRef = useRef(false);

  const showTranscriptTemporarily = useCallback((text: string) => {
    const visibleText = text.trim();
    if (!visibleText) {
      return;
    }

    setTranscript(visibleText);
    if (transcriptTimerRef.current) {
      clearTimeout(transcriptTimerRef.current);
    }
    transcriptTimerRef.current = setTimeout(() => {
      setTranscript(null);
      transcriptBufferRef.current = '';
      transcriptTimerRef.current = null;
    }, 8000);
  }, []);

  const routeAudioToSpeaker = useCallback(() => {
    InCallManager.start({ auto: true, media: 'audio' });
    InCallManager.setForceSpeakerphoneOn(true);
    InCallManager.setSpeakerphoneOn(true);
  }, []);

  const stop = useCallback(() => {
    startingRef.current = false;
    if (echoResumeTimerRef.current) {
      clearTimeout(echoResumeTimerRef.current);
      echoResumeTimerRef.current = null;
    }
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    remoteAudioTrackRef.current?.stop();
    remoteAudioTrackRef.current = null;
    remoteStreamRef.current = null;
    transcriptBufferRef.current = '';
    if (transcriptTimerRef.current) {
      clearTimeout(transcriptTimerRef.current);
      transcriptTimerRef.current = null;
    }
    setTranscript(null);
    setDiagnosticMessage(null);

    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    InCallManager.setForceSpeakerphoneOn(null);
    InCallManager.stop();
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current) {
      return;
    }

    if (peerConnectionRef.current) {
      stop();
    }

    startingRef.current = true;
    setErrorMessage(null);
    setTranscript(null);
    transcriptBufferRef.current = '';
    setStatus('connecting');

    try {
      const apiBaseUrl = getApiBaseUrl();
      if (!apiBaseUrl) {
        throw new Error(
          'EXPO_PUBLIC_API_BASE_URL is missing from the mobile environment.',
        );
      }
      setDiagnosticMessage('Backend URL loaded');

      if (Platform.OS === 'android') {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone access',
            message:
              'Interpreter.ai needs the microphone to translate live speech.',
            buttonPositive: 'Continue',
            buttonNegative: 'Cancel',
          },
        );

        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          throw new Error('Microphone permission was not granted.');
        }
      }

      const localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      console.log('[Interpreter.ai] Microphone permission granted');
      localStreamRef.current = localStream;
      setDiagnosticMessage('Microphone granted');

      routeAudioToSpeaker();

      setDiagnosticMessage('Contacting backend');
      const sessionResponse = await fetch(
        `${apiBaseUrl}/api/realtime/session`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ languageOne, languageTwo, mode }),
        },
      );
      const sessionPayload = await sessionResponse.text();
      console.log('[Interpreter.ai] Session endpoint response', {
        ok: sessionResponse.ok,
        status: sessionResponse.status,
      });

      if (!sessionResponse.ok) {
        throw new Error(
          formatRequestError(sessionPayload) ||
            `Session request failed (${sessionResponse.status}).`,
        );
      }

      const clientSecret = (JSON.parse(sessionPayload) as ClientSecretResponse)
        .value;
      if (!clientSecret) {
        throw new Error('The server did not return a Realtime client secret.');
      }
      setDiagnosticMessage('Session secret received');

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      peerConnection.ontrack = (event: unknown) => {
        const trackEvent = event as unknown as RemoteTrackEvent;
        const remoteTrack = trackEvent.track;

        if (!remoteTrack || remoteTrack.kind !== 'audio') {
          const message = 'OpenAI connected without a playable audio track.';
          console.error('[Interpreter.ai] Remote audio playback error', message);
          setErrorMessage(message);
          setStatus('error');
          return;
        }

        try {
          const remoteStream = trackEvent.streams?.[0] ?? new MediaStream([
            remoteTrack,
          ]);
          remoteStreamRef.current = remoteStream;
          remoteAudioTrackRef.current = remoteTrack;
          remoteTrack.enabled = true;
          remoteTrack._setVolume(1);

          console.log('[Interpreter.ai] Remote audio track received', {
            enabled: remoteTrack.enabled,
            id: remoteTrack.id,
            kind: remoteTrack.kind,
            streamId: remoteStream.id,
          });

          routeAudioToSpeaker();
          setDiagnosticMessage('Remote audio track received');
        } catch (error) {
          const message =
            error instanceof Error
              ? `Unable to route translated audio to the speaker: ${error.message}`
              : 'Unable to route translated audio to the speaker.';
          console.error('[Interpreter.ai] Remote audio playback error', error);
          setErrorMessage(message);
          setStatus('error');
        }
      };

      const microphoneTrack = localStream.getAudioTracks()[0];
      if (!microphoneTrack) {
        throw new Error('No microphone audio track is available.');
      }
      peerConnection.addTrack(microphoneTrack, localStream);

      peerConnection.onconnectionstatechange = () => {
        console.log(
          '[Interpreter.ai] Peer connection state',
          peerConnection.connectionState,
        );

        if (peerConnection.connectionState === 'connected') {
          setDiagnosticMessage('Peer connected');
          setStatus('listening');
        } else if (
          peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'disconnected'
        ) {
          setErrorMessage('The Realtime audio connection was lost.');
          setStatus('error');
        }
      };

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () => {
        console.log('[Interpreter.ai] Data channel opened');
        setDiagnosticMessage('Data channel open');
        setStatus('listening');
      };
      dataChannel.onerror = (event: unknown) => {
        console.error('[Interpreter.ai] Realtime data channel error', event);
        setErrorMessage('The Realtime control channel encountered an error.');
        setStatus('error');
      };
      dataChannel.onmessage = (event: { data?: unknown }) => {
        try {
          const realtimeEvent = JSON.parse(String(event.data)) as RealtimeEvent;
          if (__DEV__) {
            console.log(
              '[Interpreter.ai] OpenAI Realtime event',
              realtimeEvent.type ?? 'unknown',
            );
          }

          if (realtimeEvent.type === 'input_audio_buffer.speech_started') {
            setDiagnosticMessage('Speech detected');
            setStatus('listening');
          } else if (
            realtimeEvent.type === 'input_audio_buffer.speech_stopped'
          ) {
            setStatus('translating');
          } else if (realtimeEvent.type === 'response.created') {
            transcriptBufferRef.current = '';
            setTranscript(null);
            if (transcriptTimerRef.current) {
              clearTimeout(transcriptTimerRef.current);
              transcriptTimerRef.current = null;
            }
            setDiagnosticMessage('Response started');
            setStatus('translating');
          } else if (
            realtimeEvent.type === 'output_audio_buffer.started' ||
            realtimeEvent.type === 'response.output_audio.delta'
          ) {
            if (mode === 'browser-two-way') {
              const microphoneTrack = localStreamRef.current?.getAudioTracks()[0];
              if (microphoneTrack) microphoneTrack.enabled = false;
            }
            setDiagnosticMessage('Audio output started');
            setStatus('speaking');
          } else if (
            realtimeEvent.type === 'response.output_audio_transcript.delta'
          ) {
            transcriptBufferRef.current = (
              transcriptBufferRef.current + (realtimeEvent.delta ?? '')
            ).slice(-500);
            showTranscriptTemporarily(transcriptBufferRef.current);
          } else if (
            realtimeEvent.type === 'response.output_audio_transcript.done'
          ) {
            const completedTranscript =
              realtimeEvent.transcript ?? transcriptBufferRef.current;
            transcriptBufferRef.current = completedTranscript;
            showTranscriptTemporarily(completedTranscript);
          } else if (
            realtimeEvent.type === 'output_audio_buffer.stopped' ||
            realtimeEvent.type === 'output_audio_buffer.cleared'
          ) {
            if (mode === 'browser-two-way') {
              if (echoResumeTimerRef.current) {
                clearTimeout(echoResumeTimerRef.current);
              }
              echoResumeTimerRef.current = setTimeout(() => {
                const microphoneTrack = localStreamRef.current?.getAudioTracks()[0];
                if (microphoneTrack) microphoneTrack.enabled = true;
                echoResumeTimerRef.current = null;
                setStatus('listening');
              }, 550);
            } else {
              setStatus('listening');
            }
          } else if (realtimeEvent.type === 'response.done') {
            const responseStatus = realtimeEvent.response?.status ?? 'unknown';
            console.log('[Interpreter.ai] response.done', {
              errorDetails: realtimeEvent.response?.status_details ?? null,
              status: responseStatus,
            });

            if (
              responseStatus === 'failed' ||
              responseStatus === 'incomplete'
            ) {
              setErrorMessage(formatRealtimeResponseError(realtimeEvent));
              setStatus('error');
            }
          } else if (realtimeEvent.type === 'error') {
            console.error(
              '[Interpreter.ai] OpenAI Realtime error',
              realtimeEvent.error,
            );
            setErrorMessage(
              realtimeEvent.error?.message ?? 'OpenAI Realtime returned an error.',
            );
            setStatus('error');
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? `Unable to read OpenAI Realtime event: ${error.message}`
              : 'Unable to read an OpenAI Realtime event.';
          console.error('[Interpreter.ai] Realtime event parsing error', error);
          setErrorMessage(message);
          setStatus('error');
        }
      };

      setDiagnosticMessage('Creating WebRTC offer');
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const offerSdp = peerConnection.localDescription?.sdp ?? offer.sdp;
      if (!offerSdp) {
        throw new Error('Unable to create the Realtime audio offer.');
      }

      const sdpResponse = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: offerSdp,
      });
      const answerSdp = await sdpResponse.text();

      if (!sdpResponse.ok) {
        throw new Error(
          answerSdp || `Realtime connection failed (${sdpResponse.status}).`,
        );
      }
      setDiagnosticMessage('SDP answer received');

      await peerConnection.setRemoteDescription(
        new RTCSessionDescription({ sdp: answerSdp, type: 'answer' }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start interpreting.';
      console.error('[Interpreter.ai] Connection or playback error', error);
      dataChannelRef.current?.close();
      dataChannelRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      remoteAudioTrackRef.current?.stop();
      remoteAudioTrackRef.current = null;
      remoteStreamRef.current = null;
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
    languageOne,
    languageTwo,
    mode,
    routeAudioToSpeaker,
    showTranscriptTemporarily,
    stop,
  ]);

  useEffect(() => stop, [stop]);

  return {
    diagnosticMessage,
    errorMessage,
    isActive: status !== 'idle' && status !== 'error',
    start,
    status,
    stop,
    transcript,
  };
}
