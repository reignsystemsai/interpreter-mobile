export type MicPermissionStatus = 'granted' | 'denied' | 'undetermined';

// Public contract only — no implementation yet. iOS owns microphone permission
// persistence; this shell checks and reuses it, it never stores permission state
// itself and Supabase is never responsible for it.
export interface AudioShell {
  // Call start lifecycle, in order:
  checkMicrophonePermission(): Promise<MicPermissionStatus>;
  requestMicrophonePermission(): Promise<MicPermissionStatus>; // only called if not already granted
  activateCallAudioSession(): Promise<void>;
  connectRoom(input: { livekitUrl: string; token: string }): Promise<void>;
  enableLocalMicrophone(): Promise<void>;
  publishMicrophoneTrack(): Promise<void>;
  subscribeToRemoteMicrophone(onRemoteAudio: () => void): Promise<void>;
  verifyAudioActive(): Promise<boolean>;

  // Call end lifecycle, in order:
  disableMicrophone(): Promise<void>;
  detachSubscriptions(): Promise<void>;
  disconnectRoom(): Promise<void>;
  releaseCallAudioState(): Promise<void>;
}
