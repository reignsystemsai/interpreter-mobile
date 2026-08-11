import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { AudioPresets, ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';

import type { AudioShell, MicPermissionStatus } from './AudioShell';

const AUDIO_CAPTURE = { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;

export class LiveAudioShell implements AudioShell {
  private room: Room | null = null;

  async checkMicrophonePermission(): Promise<MicPermissionStatus> {
    if (Platform.OS !== 'android') return 'granted';
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return granted ? 'granted' : 'undetermined';
  }

  async requestMicrophonePermission(): Promise<MicPermissionStatus> {
    if (Platform.OS !== 'android') return 'granted';
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  }

  async activateCallAudioSession(): Promise<void> {
    await AudioSession.stopAudioSession().catch(() => undefined);
    await AudioSession.configureAudio({
      android: {
        audioTypeOptions: { ...AndroidAudioTypePresets.communication, forceHandleAudioRouting: true },
        preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
      },
      ios: { defaultOutput: 'speaker' },
    });
    await AudioSession.setDefaultRemoteAudioTrackVolume(1);
    await AudioSession.startAudioSession();
  }

  async connectRoom(input: { livekitUrl: string; token: string }): Promise<void> {
    const room = new Room({
      adaptiveStream: true,
      audioCaptureDefaults: AUDIO_CAPTURE,
      publishDefaults: { audioPreset: AudioPresets.speech, dtx: true, forceStereo: false, red: true },
    });
    this.room = room;
    await room.connect(input.livekitUrl, input.token, { autoSubscribe: false, maxRetries: 3 });
  }

  async enableLocalMicrophone(): Promise<void> {
    if (!this.room) throw new Error('Room is not connected');
    await this.room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE);
  }

  async publishMicrophoneTrack(): Promise<void> {}

  async subscribeToRemoteMicrophone(onRemoteAudio: () => void): Promise<void> {
    const room = this.room;
    if (!room) throw new Error('Room is not connected');
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) publication.setSubscribed(true);
    }
    room.on(RoomEvent.TrackPublished, (publication) => publication.setSubscribed(true));
    room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) onRemoteAudio(); });
  }

  async verifyAudioActive(): Promise<boolean> {
    return this.room?.state === ConnectionState.Connected;
  }

  async disableMicrophone(): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
  }

  async detachSubscriptions(): Promise<void> {
    if (!this.room) return;
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        publication.track?.detach();
        if (publication.isSubscribed) publication.setSubscribed(false);
      }
    }
  }

  async disconnectRoom(): Promise<void> {
    if (!this.room) return;
    this.room.removeAllListeners();
    await this.room.disconnect().catch(() => undefined);
    this.room = null;
  }

  async releaseCallAudioState(): Promise<void> {
    await AudioSession.stopAudioSession().catch(() => undefined);
  }
}
