import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import InCallManager from 'react-native-incall-manager';
import {
  MediaStream,
  MediaStreamTrack,
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(
  /\/+$/,
  '',
);

type RealtimeEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: {
    message?: string;
  };
  response?: {
    status?: string;
    status_details?: {
      error?: {
        message?: string;
      };
    };
  };
};

type SessionSecretResponse = {
  value?: string;
  client_secret?: {
    value?: string;
  };
  error?: string;
  detail?: string;
};

type NativeEventTarget = {
  addEventListener: (
    type: string,
    listener: (event: any) => void,
  ) => void;
};

function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\b(?:sk|ek)_[A-Za-z0-9_-]+\b/g, '[redacted-secret]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[redacted-secret]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

async function readSafeResponseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(text) as SessionSecretResponse;
    return [data.error, data.detail].filter(Boolean).join(' — ');
  } catch {
    return text.slice(0, 500);
  }
}

export default function App() {
  const [status, setStatus] = useState('Ready');
  const [logs, setLogs] = useState<string[]>(['App loaded']);
  const [transcript, setTranscript] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<
    ReturnType<RTCPeerConnection['createDataChannel']> | null
  >(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const responseActiveRef = useRef(false);
  const transcriptBufferRef = useRef('');
  const stoppingRef = useRef(false);
  const runIdRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const addLog = useCallback((message: string) => {
    const line = `${new Date().toLocaleTimeString()}  ${message}`;
    setLogs((current) => [...current, line]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 0);
  }, []);

  const setStage = useCallback(
    (message: string) => {
      setStatus(message);
      addLog(message);
    },
    [addLog],
  );

  useEffect(() => {
    addLog(
      API_BASE_URL
        ? `Backend URL loaded: ${API_BASE_URL}`
        : 'Backend URL missing: set EXPO_PUBLIC_API_BASE_URL',
    );
  }, [addLog]);

  const stop = useCallback(
    (reason = 'Stopped') => {
      if (stoppingRef.current) {
        return;
      }
      stoppingRef.current = true;
      runIdRef.current += 1;

      try {
        requestAbortRef.current?.abort();
        dataChannelRef.current?.close();
        peerRef.current?.close();
        microphoneStreamRef.current
          ?.getTracks()
          .forEach((track) => track.stop());
        remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
        InCallManager.stop();
      } finally {
        dataChannelRef.current = null;
        peerRef.current = null;
        microphoneStreamRef.current = null;
        remoteStreamRef.current = null;
        remoteAudioTrackRef.current = null;
        requestAbortRef.current = null;
        responseActiveRef.current = false;
        setIsRunning(false);
        setStatus(reason);
        addLog(reason);
        stoppingRef.current = false;
      }
    },
    [addLog],
  );

  useEffect(() => () => stop('App closed'), [stop]);

  const handleRealtimeEvent = useCallback(
    (rawData: string) => {
      let event: RealtimeEvent;

      try {
        event = JSON.parse(rawData) as RealtimeEvent;
      } catch {
        addLog('Ignored an unreadable Realtime event');
        return;
      }

      switch (event.type) {
        case 'input_audio_buffer.speech_started':
          setStage(
            responseActiveRef.current
              ? 'Speech detected — interrupting translation'
              : 'Speech detected',
          );
          break;

        case 'response.created':
        case 'response.output_item.added':
          if (!responseActiveRef.current) {
            responseActiveRef.current = true;
            transcriptBufferRef.current = '';
            setTranscript('');
            setStage('Translation response started');
          }
          break;

        case 'response.output_audio.delta':
        case 'response.audio.delta':
          setStage('Audio output received');
          break;

        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta': {
          const delta = event.delta || '';
          transcriptBufferRef.current += delta;
          setTranscript(transcriptBufferRef.current);
          break;
        }

        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done': {
          const completed = event.transcript || transcriptBufferRef.current;
          transcriptBufferRef.current = completed;
          setTranscript(completed);
          if (completed) {
            addLog(`Translation transcript: ${completed}`);
          }
          break;
        }

        case 'response.done': {
          responseActiveRef.current = false;
          const responseError =
            event.response?.status_details?.error?.message ||
            (event.response?.status === 'failed'
              ? 'Realtime response failed'
              : '');
          if (responseError) {
            setStage(`Error: ${safeMessage(responseError)}`);
          } else {
            setStatus('Listening');
          }
          break;
        }

        case 'error': {
          const message = safeMessage(
            event.error?.message || 'Unknown Realtime error',
          );
          setStage(`Error: ${message}`);
          break;
        }
      }
    },
    [addLog, setStage],
  );

  const start = useCallback(async () => {
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    setTranscript('');
    stoppingRef.current = false;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const requestAbort = new AbortController();
    requestAbortRef.current = requestAbort;

    const assertActive = () => {
      if (runId !== runIdRef.current) {
        throw new Error('Interpreter start was cancelled.');
      }
    };

    try {
      if (!API_BASE_URL) {
        throw new Error(
          'EXPO_PUBLIC_API_BASE_URL is missing. Copy mobile/.env.example to mobile/.env and set the backend URL.',
        );
      }

      if (Platform.OS !== 'android') {
        throw new Error('This MVP is configured and validated for Android.');
      }

      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone permission',
          message:
            'Interpreter.ai needs the microphone to translate spoken English and Brazilian Portuguese.',
          buttonPositive: 'Allow',
          buttonNegative: 'Cancel',
        },
      );

      if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('Microphone permission was not granted.');
      }
      assertActive();
      setStage('Microphone permission granted');

      setStage('Contacting backend');
      const secretResponse = await fetch(
        `${API_BASE_URL}/api/realtime/session`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
          signal: requestAbort.signal,
        },
      );
      assertActive();

      if (!secretResponse.ok) {
        throw new Error(
          `Backend session request failed: ${await readSafeResponseError(
            secretResponse,
          )}`,
        );
      }

      const secretPayload =
        (await secretResponse.json()) as SessionSecretResponse;
      const clientSecret =
        secretPayload.value || secretPayload.client_secret?.value;

      if (!clientSecret) {
        throw new Error('Backend response did not contain a session secret.');
      }
      setStage('Session secret received');

      InCallManager.start({ media: 'audio', auto: true });
      InCallManager.setForceSpeakerphoneOn(true);
      InCallManager.setSpeakerphoneOn(true);

      const microphoneStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      microphoneStreamRef.current = microphoneStream;
      assertActive();
      setStage('Microphone stream created');

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      const peerEvents = peer as unknown as NativeEventTarget;

      peerEvents.addEventListener('track', (event: {
        track: MediaStreamTrack;
        streams: MediaStream[];
      }) => {
        const receivedTrack = event.track;
        receivedTrack.enabled = true;
        remoteAudioTrackRef.current = receivedTrack;

        const receivedStream = event.streams[0] || new MediaStream();
        if (!event.streams[0]) {
          receivedStream.addTrack(receivedTrack);
        }
        remoteStreamRef.current = receivedStream;

        InCallManager.setForceSpeakerphoneOn(true);
        InCallManager.setSpeakerphoneOn(true);
        setStage('Remote audio track received');
      });

      peerEvents.addEventListener('connectionstatechange', () => {
        switch (peer.connectionState) {
          case 'connected':
            setStage('Peer connected');
            setStatus('Listening');
            break;
          case 'failed':
            setStage('Error: WebRTC peer connection failed');
            break;
          case 'disconnected':
            addLog('Peer disconnected');
            break;
          case 'closed':
            addLog('Peer connection closed');
            break;
        }
      });

      microphoneStream
        .getAudioTracks()
        .forEach((track) => peer.addTrack(track, microphoneStream));

      const dataChannel = peer.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      const dataChannelEvents = dataChannel as unknown as NativeEventTarget;
      dataChannelEvents.addEventListener('open', () => {
        setStage('Data channel open');
        setStatus('Listening');
      });
      dataChannelEvents.addEventListener('message', (event: { data: unknown }) => {
        handleRealtimeEvent(String(event.data));
      });
      dataChannelEvents.addEventListener('error', () => {
        setStage('Error: Realtime data channel error');
      });

      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
      });
      await peer.setLocalDescription(offer);
      setStage('WebRTC offer created');

      const sdpResponse = await fetch(OPENAI_REALTIME_CALLS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
        signal: requestAbort.signal,
      });
      assertActive();

      if (!sdpResponse.ok) {
        throw new Error(
          `OpenAI SDP exchange failed: ${await readSafeResponseError(
            sdpResponse,
          )}`,
        );
      }

      const answerSdp = await sdpResponse.text();
      setStage('SDP answer received');
      await peer.setRemoteDescription(
        new RTCSessionDescription({
          type: 'answer',
          sdp: answerSdp,
        }),
      );
      assertActive();

      setStatus('Connecting peer');
    } catch (error) {
      if (
        runId !== runIdRef.current ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        stop('Stopped');
        return;
      }
      const message = safeMessage(error);
      stop('Stopped after error');
      setStage(`Error: ${message}`);
    }
  }, [handleRealtimeEvent, isRunning, setStage, stop]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <Text style={styles.title}>Interpreter.ai</Text>
        <Text style={styles.statusLabel}>STATUS</Text>
        <Text style={styles.status}>{status}</Text>

        <View style={styles.actions}>
          <View style={styles.button}>
            <Button
              title="Start interpreting"
              onPress={start}
              disabled={isRunning}
            />
          </View>
          <View style={styles.button}>
            <Button title="Stop" onPress={() => stop()} disabled={!isRunning} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Translated output transcript</Text>
        <View style={styles.transcriptBox}>
          <Text style={styles.transcript}>
            {transcript || 'Waiting for translated speech…'}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Diagnostic log</Text>
        <ScrollView ref={scrollRef} style={styles.logBox}>
          {logs.map((line, index) => (
            <Text key={`${index}-${line}`} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 20,
  },
  title: {
    color: '#111827',
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 28,
  },
  statusLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  status: {
    color: '#0f172a',
    fontSize: 23,
    fontWeight: '600',
    minHeight: 66,
    paddingTop: 6,
  },
  actions: {
    flexDirection: 'row',
    marginBottom: 22,
  },
  button: {
    flex: 1,
    marginRight: 10,
  },
  sectionTitle: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  transcriptBox: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 94,
    padding: 12,
    marginBottom: 18,
  },
  transcript: {
    color: '#111827',
    fontSize: 17,
    lineHeight: 24,
  },
  logBox: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
  },
  logLine: {
    color: '#dbeafe',
    fontFamily: Platform.select({ android: 'monospace' }),
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
});
