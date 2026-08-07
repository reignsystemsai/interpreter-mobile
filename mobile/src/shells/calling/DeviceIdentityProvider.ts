import { getDeviceId } from '../../services/deviceRegistration';

export interface DeviceIdentityProvider {
  getDeviceId(): Promise<string>;
}

// Reuses the existing device-identity source (the same one VoiceCallService already
// uses) rather than introducing a second one. UI never reads device identity itself.
export class RegisteredDeviceIdentityProvider implements DeviceIdentityProvider {
  getDeviceId(): Promise<string> {
    return getDeviceId();
  }
}
