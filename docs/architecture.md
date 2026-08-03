# Interpreter.ai modular architecture

The OpenAI Realtime media path remains direct from the Android client to OpenAI
after the existing Render service issues a short-lived credential. Account and
commerce work must never add a proxy hop to live audio.

## Service boundaries

- **Realtime interpretation:** existing `/api/realtime/session` route and direct
  WebRTC media. This remains stateless and latency-sensitive.
- **Identity:** Supabase Auth issues user sessions. The mobile client stores its
  refresh session in encrypted device storage. Render validates access tokens;
  the Supabase service-role key is server-only.
- **Account data:** Supabase Postgres with row-level security and cascade deletion.
- **Subscriptions:** Google Play Billing through RevenueCat. RevenueCat webhooks
  update a server-owned entitlement projection; the client never grants itself
  paid access.
- **Usage:** period-based usage rows are partitionable by date and user. Free is
  2 interpreted minutes per day; Pro is 500 minutes per month; Unlimited is
  2,000 minutes per month under fair use. Paid rollover lasts one billing cycle.
- **Notifications:** Expo push tokens and preferences are isolated from account
  profiles so notification delivery can move to a separate worker.
- **Calling, transcripts, summaries, and future AI:** separate modules and data
  stores. They must consume entitlement decisions through clean APIs rather than
  coupling to the Realtime session implementation.

## Scale and safety

Render API instances remain stateless. Supabase supplies pooled database access,
indexes, row-level security, and managed authentication. Subscription webhooks
are idempotent by event ID. Notification delivery and summaries should run on
queues, never inside latency-sensitive API requests. Audio is session-only and
is not stored by this foundation.

Before enabling customer accounts, add rate limits, abuse controls, database
backups, audit logging, monitoring, and a production load test. Before enforcing
paid limits, meter Realtime session duration server-side or through a signed
reservation/finalization protocol; never trust a client-only usage counter.
