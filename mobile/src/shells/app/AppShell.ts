import type { CallSession } from '../data/CallSession';

export type AppTab = 'home' | 'capsules' | 'messages' | 'camera';

export interface AppShellNavigation {
  activeTab: AppTab;
  setActiveTab(tab: AppTab): void;
  openUtilities(): void;
}

// UI components request these actions; they must never manipulate LiveKit tracks,
// create OpenAI sessions, manage mic state, or determine caller/recipient routing
// themselves. Those responsibilities belong to the Calling/Audio/Interpreter shells.
export interface SpeakActions {
  startInterpreterCall(input: { recipientPhoneNumber: string; callerLanguage: string; recipientLanguage: string }): Promise<CallSession>;
  answerCall(callId: string): Promise<CallSession>;
  endCall(callId: string): Promise<void>;
}
