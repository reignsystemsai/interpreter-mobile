# Deprecated calling schema

The following applied migrations belong to the disconnected calling implementation and must not be used by the clean calling rebuild:

- `202608030003_calling_foundation.sql`
- `202608030004_interpreted_calling.sql`
- `202608040001_device_installations.sql`
- `202608040001_three_minute_interpreter_trial.sql`

Their calling tables, policies, indexes, and functions are historical only. Phase 1 does not rewrite applied migrations or execute destructive database changes. The clean calling foundation will supersede this schema with a new migration after its exact two-table contract is defined.
