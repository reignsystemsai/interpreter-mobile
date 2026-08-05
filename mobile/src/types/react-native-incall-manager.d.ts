declare module 'react-native-incall-manager' {
  type StartOptions = {
    auto?: boolean;
    media?: 'audio' | 'video';
    ringback?: boolean | string;
  };

  const InCallManager: {
    setForceSpeakerphoneOn(enabled: boolean | null): void;
    setKeepScreenOn(enabled: boolean): void;
    setSpeakerphoneOn(enabled: boolean): void;
    start(options?: StartOptions): void;
    startRingback(ringback: string): void;
    startRingtone(ringtone: string, vibratePattern: number | number[], iosCategory: string, seconds: number): void;
    stop(): void;
    stopRingback(): void;
    stopRingtone(): void;
    turnScreenOn(): void;
  };

  export default InCallManager;
}
