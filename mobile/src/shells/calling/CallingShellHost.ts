import { BackendCallDataShell } from '../data/BackendCallDataShell';
import { CallingShellImpl } from './CallingShellImpl';
import { RegisteredDeviceIdentityProvider } from './DeviceIdentityProvider';

// Matches the id-generation pattern already used by getDeviceId() in
// services/deviceRegistration.ts. The project has no uuid/expo-crypto dependency, so
// there is no separate ID-generation utility to import instead.
function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const deviceIdentity = new RegisteredDeviceIdentityProvider();

// Single shared instance for the whole app, mirroring VoiceCallService's own
// module-level singleton pattern. Importing this file alone does not activate
// anything — only callers that invoke methods on it do.
export const CallingShellHost = new CallingShellImpl({
  callData: new BackendCallDataShell(deviceIdentity),
  deviceIdentity,
  createId,
});
