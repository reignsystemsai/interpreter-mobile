module.exports = ({ config }) => ({
  ...config,
  extra: {
      ...config.extra,
      livekitUrl: process.env.LIVEKIT_URL || '',
  },
});
