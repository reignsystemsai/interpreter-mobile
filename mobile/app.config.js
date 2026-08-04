module.exports = ({ config }) => ({
  ...config,
  extra: {
      ...config.extra,
      livekitUrl: process.env.LIVEKIT_URL || '',
      supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
      supabaseUrl: process.env.SUPABASE_URL || '',
  },
});
