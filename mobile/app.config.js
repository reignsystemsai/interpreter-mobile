const baseConfig = require('./app.json');

module.exports = () => ({
  ...baseConfig,
  expo: {
    ...baseConfig.expo,
    extra: {
      ...baseConfig.expo.extra,
      livekitUrl: process.env.LIVEKIT_URL || '',
      supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
      supabaseUrl: process.env.SUPABASE_URL || '',
    },
  },
});
