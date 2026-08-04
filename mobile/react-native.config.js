module.exports = {
  dependencies: {
    // JavaScript compatibility alias only. The native module is linked through
    // @livekit/react-native-webrtc and must not be autolinked a second time.
    'react-native-webrtc': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
