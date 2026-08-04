declare module 'react-native-webrtc' {
  export type MediaStreamTrack = any;
  export const mediaDevices: any;

  export class MediaStream {
    constructor(tracks?: MediaStreamTrack[]);
    getAudioTracks(): MediaStreamTrack[];
    getTracks(): MediaStreamTrack[];
  }

  export class RTCSessionDescription {
    constructor(description: { sdp?: string; type?: string });
  }

  export class RTCPeerConnection {
    constructor(configuration?: unknown);
    [key: string]: any;
    createDataChannel(label: string): any;
  }
}
