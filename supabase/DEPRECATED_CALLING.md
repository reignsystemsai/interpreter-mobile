# Deprecated calling schema

The following applied migrations belong to the disconnected calling implementation and must not be used by the clean calling rebuild:

- `202608030003_calling_foundation.sql`
- `202608030004_interpreted_calling.sql`
- `202608040001_device_installations.sql`
- `202608040001_three_minute_interpreter_trial.sql`

Their calling tables, policies, indexes, and functions are historical only. They are superseded by `202608050001_clean_voice_call_rebuild.sql`, which removes the old account-based calling objects and creates only `device_installations` and `active_calls` for the clean voice-call architecture.
