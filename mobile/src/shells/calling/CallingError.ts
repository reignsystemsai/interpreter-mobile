export type CallingErrorCode =
  | 'ACTIVE_CALL_EXISTS'
  | 'CALL_NOT_FOUND'
  | 'CALL_ID_MISMATCH'
  | 'INVALID_CALL_STATE'
  | 'RECIPIENT_ALREADY_CLAIMED'
  | 'DEVICE_ALREADY_ACTIVE'
  | 'PERSISTENCE_FAILED'
  | 'STALE_OPERATION';

// Raw Supabase/PostgreSQL errors must never reach UI-facing callers; data-layer
// implementations should catch and rethrow as one of these codes, preserving the
// original error via `cause`.
export class CallingError extends Error {
  readonly code: CallingErrorCode;
  readonly cause?: unknown;

  constructor(code: CallingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'CallingError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
