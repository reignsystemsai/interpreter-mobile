import {
  isKrispNoiseFilterSupported,
  KrispNoiseFilter,
  type KrispNoiseFilterProcessor,
} from '@livekit/react-native-krisp-noise-filter';
import { LocalAudioTrack } from 'livekit-client';

export class SpeakMicrophoneAudioProcessor {
  private attachedTrack: LocalAudioTrack | null = null;
  private operation = Promise.resolve();
  private processor: KrispNoiseFilterProcessor | null = null;
  private warned = false;

  attach(track: LocalAudioTrack) {
    this.operation = this.operation.then(async () => {
      if (this.attachedTrack === track) return;
      await this.detachNow();
      if (!isKrispNoiseFilterSupported()) {
        this.warnOnce('Krisp microphone filtering is unavailable; using native WebRTC audio.');
        return;
      }
      try {
        const processor = KrispNoiseFilter();
        await track.setProcessor(processor);
        this.attachedTrack = track;
        this.processor = processor;
      } catch {
        await track.stopProcessor().catch(() => undefined);
        this.warnOnce('Krisp microphone filtering failed; using native WebRTC audio.');
      }
    });
    return this.operation;
  }

  dispose() {
    this.operation = this.operation.then(() => this.detachNow());
    return this.operation;
  }

  private async detachNow() {
    const track = this.attachedTrack;
    const processor = this.processor;
    this.attachedTrack = null;
    this.processor = null;
    if (track) await track.stopProcessor().catch(() => undefined);
    if (processor) await processor.destroy().catch(() => undefined);
  }

  private warnOnce(message: string) {
    if (__DEV__ && !this.warned) {
      this.warned = true;
      console.warn(`[VoiceCall] ${message}`);
    }
  }
}

export function isLocalMicrophoneTrack(track: unknown): track is LocalAudioTrack {
  return track instanceof LocalAudioTrack;
}