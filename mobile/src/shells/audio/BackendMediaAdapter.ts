import { API_BASE_URL } from '../../config/runtime';
import { VoiceCallService, type MediaSessionCredentials } from '../../features/calling/VoiceCallService';
import { CallingError } from '../calling/CallingError';
import { CallingShellHost } from '../calling/CallingShellHost';
import { RegisteredDeviceIdentityProvider, type DeviceIdentityProvider } from '../calling/DeviceIdentityProvider';

type MediaSessionPayload = {
  callId: string;
  roomName: string;
  livekitUrl: string;
  token: string;
  translationEnabled: boolean;
};

type ApiErrorPayload = { code?: string; error?: string };

async function requestMediaCredentials(callId: string, deviceId: string): Promise<MediaSessionPayload> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/media-sessions/${encodeURIComponent(callId)}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    });
  } catch (cause) {
    throw new CallingError('PERSISTENCE_FAILED', 'Unable to reach the media service.', { cause });
  }
  const payload = (await response.json().catch(() => ({}))) as MediaSessionPayload & ApiErrorPayload;
  if (!response.ok) {
    throw new CallingError('PERSISTENCE_FAILED', payload.error || 'Unable to start media for this call.');
  }
  return payload;
}

// Bridges the canonical CallingShellHost (call-data authority — speak_call_sessions)
// to VoiceCallService's existing LiveKit mechanics (media authority). Holds no call
// state of its own: CallingShellHost's session is the single source of truth for
// whether a call is active. Never touches translation, microphone, track-subscription,
// or audio-session logic directly — all of that stays inside VoiceCallService.
export class BackendMediaAdapter {
  private readonly deviceIdentity: DeviceIdentityProvider;
  private unsubscribe: (() => void) | null = null;
  private connectedCallId: string | null = null;

  constructor(deviceIdentity: DeviceIdentityProvider) {
    this.deviceIdentity = deviceIdentity;
  }

  // Ends VoiceCallService's media connection whenever the canonical shell reports the
  // call is over. CallingShellImpl only ever commits a null session on end/decline
  // today (there is no reachable "failed" session state yet), so that is the one
  // transition observed here.
  start() {
    if (this.unsubscribe) return;
    this.unsubscribe = CallingShellHost.subscribe((session) => {
      if (session === null && this.connectedCallId) {
        this.connectedCallId = null;
        void VoiceCallService.disconnectMedia();
      }
    });
  }

  async connect(callId: string, remoteLabel: string, role: 'caller' | 'recipient'): Promise<void> {
    const deviceId = await this.deviceIdentity.getDeviceId();
    const credentials = await requestMediaCredentials(callId, deviceId);
    this.connectedCallId = callId;
    const mediaCredentials: MediaSessionCredentials = {
      callId: credentials.callId,
      roomName: credentials.roomName,
      livekitUrl: credentials.livekitUrl,
      token: credentials.token,
      translationEnabled: credentials.translationEnabled,
      role,
      remoteLabel,
    };
    await VoiceCallService.connectMedia(mediaCredentials, () => {
      void CallingShellHost.confirmConnected(callId).catch(() => undefined);
    });
  }
}

export const backendMediaAdapter = new BackendMediaAdapter(new RegisteredDeviceIdentityProvider());
