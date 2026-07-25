import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStream,
} from 'react-native-webrtc';

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

type InterpreterStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'translating'
  | 'speaking'
  | 'error';

type ClientSecretResponse = {
  value?: string;
  error?: string;
};

type RealtimeEvent = {
  type?: string;
  error?: {
    message?: string;
  };
};

function getApiBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');
}

function formatRequestError(payload: string) {
  try {
    const parsed = JSON.parse(payload) as ClientSecretResponse;
    return parsed.error ?? payload;
  } catch {
    return payload;
  }
}

export function useRealtimeInterpreter(
  languageOne: string,
  languageTwo: string,
) {
  const [status, setStatus] = useState<InterpreterStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<
    ReturnType<RTCPeerConnection['createDataChannel']> | null
  >(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);

  const stop = useCallback(() => {
    startingRef.current = false;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

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
    setStatus('connecting');

    try {
      const apiBaseUrl = getApiBaseUrl();
      if (!apiBaseUrl) {
        throw new Error(
          'EXPO_PUBLIC_API_BASE_URL is missing from the mobile environment.',
        );
      }

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
      localStreamRef.current = localStream;

      InCallManager.start({ auto: true, media: 'audio' });
      InCallManager.setForceSpeakerphoneOn(true);
      InCallManager.setSpeakerphoneOn(true);

      const sessionResponse = await fetch(
        `${apiBaseUrl}/api/realtime/session`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ languageOne, languageTwo }),
        },
      );
      const sessionPayload = await sessionResponse.text();

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

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      const microphoneTrack = localStream.getAudioTracks()[0];
      if (!microphoneTrack) {
        throw new Error('No microphone audio track is available.');
      }
      peerConnection.addTrack(microphoneTrack, localStream);

      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'connected') {
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
      dataChannel.onopen = () => setStatus('listening');
      dataChannel.onmessage = (event: { data?: unknown }) => {
        try {
          const realtimeEvent = JSON.parse(String(event.data)) as RealtimeEvent;

          if (realtimeEvent.type === 'input_audio_buffer.speech_started') {
            setStatus('listening');
          } else if (
            realtimeEvent.type === 'input_audio_buffer.speech_stopped'
          ) {
            setStatus('translating');
          } else if (
            realtimeEvent.type === 'output_audio_buffer.started' ||
            realtimeEvent.type === 'response.output_audio.delta'
          ) {
            setStatus('speaking');
          } else if (
            realtimeEvent.type === 'output_audio_buffer.stopped' ||
            realtimeEvent.type === 'response.done'
          ) {
            setStatus('listening');
          } else if (realtimeEvent.type === 'error') {
            setErrorMessage(
              realtimeEvent.error?.message ?? 'OpenAI Realtime returned an error.',
            );
            setStatus('error');
          }
        } catch {
          // Ignore non-JSON data-channel messages.
        }
      };

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

      await peerConnection.setRemoteDescription(
        new RTCSessionDescription({ sdp: answerSdp, type: 'answer' }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start interpreting.';
      dataChannelRef.current?.close();
      dataChannelRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
      InCallManager.setForceSpeakerphoneOn(null);
      InCallManager.stop();
      setErrorMessage(message);
      setStatus('error');
    } finally {
      startingRef.current = false;
    }
  }, [languageOne, languageTwo, stop]);

  useEffect(() => stop, [stop]);

  return {
    errorMessage,
    isActive: status !== 'idle' && status !== 'error',
    start,
    status,
    stop,
  };
}
