module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []),
    ...((config.plugins || []).some((plugin) => plugin === 'expo-asset' || (Array.isArray(plugin) && plugin[0] === 'expo-asset'))
      ? []
      : ['expo-asset']),
    ...((config.plugins || []).some((plugin) => plugin === 'expo-audio' || (Array.isArray(plugin) && plugin[0] === 'expo-audio'))
      ? []
      : [[
          'expo-audio',
          {
            microphonePermission: 'Interpreter.ai uses the microphone for translation and voice or video calls.',
            recordAudioAndroid: false,
            enableBackgroundRecording: false,
          },
        ]]),
  ],
  extra: {
      ...config.extra,
      livekitUrl: process.env.LIVEKIT_URL || '',
      supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
      supabaseUrl: process.env.SUPABASE_URL || '',
  },
});
