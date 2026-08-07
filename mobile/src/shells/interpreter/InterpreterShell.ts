import type { CallRole, CallSession } from '../data/CallSession';

// Public contract only — translation is NOT implemented in this phase.
export type InterpreterDirectionState = {
  role: CallRole;
  sourceLanguage: string;
  targetLanguage: string;
  outputTrackName: `translation-to-${CallRole}`;
  audibleBy: CallRole;
};

export type InterpreterDirections = {
  caller: InterpreterDirectionState;
  recipient: InterpreterDirectionState;
};

// caller speaks -> translated -> recipient hears only
// recipient speaks -> translated -> caller hears only
// The two directions must carry fully independent state — one direction's
// cancellation/generation state must never affect the other.
export function configureInterpreterDirections(session: Pick<CallSession, 'callerLanguage' | 'recipientLanguage'>): InterpreterDirections {
  return {
    caller: {
      audibleBy: 'recipient',
      outputTrackName: 'translation-to-recipient',
      role: 'caller',
      sourceLanguage: session.callerLanguage,
      targetLanguage: session.recipientLanguage,
    },
    recipient: {
      audibleBy: 'caller',
      outputTrackName: 'translation-to-caller',
      role: 'recipient',
      sourceLanguage: session.recipientLanguage,
      targetLanguage: session.callerLanguage,
    },
  };
}

export interface InterpreterShell {
  configureDirections(session: Pick<CallSession, 'callerLanguage' | 'recipientLanguage'>): InterpreterDirections;
  // Deliberately no translate()/attach()/publish() methods yet — those belong to the
  // implementation built in a later phase, not this contract.
}
