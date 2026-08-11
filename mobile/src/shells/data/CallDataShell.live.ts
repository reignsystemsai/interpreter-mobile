import { API_BASE_URL } from '../../config/runtime';
import { getDeviceId } from '../../services/deviceRegistration';

export type PlainCallConnection = {
  callId: string;
  livekitUrl: string;
  roomName: string;
  token: string;
};

export class LiveCallDataGateway {
  async startCall(input: { callerLanguage: string; defaultRegion?: string; recipientLanguage: string; recipientPhoneNumber: string }): Promise<PlainCallConnection> {
    const callerDeviceId = await getDeviceId();
    const response = await fetch(`${API_BASE_URL}/api/v1/calls/start`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerDeviceId,
        callerLanguage: input.callerLanguage,
        defaultRegion: input.defaultRegion,
        recipientPhoneNumber: input.recipientPhoneNumber,
        recipientLanguage: input.recipientLanguage,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { callId?: string; callerToken?: string; error?: string; livekitUrl?: string; roomName?: string };
    if (!response.ok || !payload.callId || !payload.callerToken || !payload.livekitUrl || !payload.roomName) {
      throw new Error(payload.error || 'Unable to start call.');
    }
    return { callId: payload.callId, livekitUrl: payload.livekitUrl, roomName: payload.roomName, token: payload.callerToken };
  }

  async acceptCall(callId: string): Promise<PlainCallConnection> {
    const recipientDeviceId = await getDeviceId();
    const response = await fetch(`${API_BASE_URL}/api/v1/calls/${encodeURIComponent(callId)}/accept`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientDeviceId, translationCapable: false }),
    });
    const payload = (await response.json().catch(() => ({}))) as { callId?: string; error?: string; livekitUrl?: string; recipientToken?: string; roomName?: string };
    if (!response.ok || !payload.callId || !payload.recipientToken || !payload.livekitUrl || !payload.roomName) {
      throw new Error(payload.error || 'Unable to accept call.');
    }
    return { callId: payload.callId, livekitUrl: payload.livekitUrl, roomName: payload.roomName, token: payload.recipientToken };
  }

  async endCall(callId: string): Promise<void> {
    const deviceId = await getDeviceId().catch(() => '');
    if (!deviceId) return;
    await fetch(`${API_BASE_URL}/api/v1/calls/${encodeURIComponent(callId)}/end`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    }).catch(() => undefined);
  }
}
