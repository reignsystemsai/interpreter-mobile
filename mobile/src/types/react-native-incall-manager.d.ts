declare module 'react-native-incall-manager' {
  type StartOptions = {
    auto?: boolean;
    media?: 'audio' | 'video';
    ringback?: boolean | string;
  };

  const InCallManager: {
    setForceSpeakerphoneOn(enabled: boolean | null): void;
    setSpeakerphoneOn(enabled: boolean): void;
    start(options?: StartOptions): void;
    stop(): void;
  };

  export default InCallManager;
}
