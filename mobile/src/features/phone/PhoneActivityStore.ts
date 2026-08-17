export type PhoneTab = 'messages' | 'recents' | 'connections' | 'keypad' | 'voice';

export type RecentCall = {
  callId: string;
  id: string;
  kind: 'incoming' | 'missed' | 'outgoing';
  label: string;
  phone: string;
  timestamp: number;
};

const openListeners = new Set<(tab: PhoneTab) => void>();
const recentListeners = new Set<() => void>();
let recentCalls: readonly RecentCall[] = [];

export function requestPhoneOpen(tab: PhoneTab) {
  openListeners.forEach((listener) => listener(tab));
}

export function subscribePhoneOpen(listener: (tab: PhoneTab) => void) {
  openListeners.add(listener);
  return () => { openListeners.delete(listener); };
}

export function recordRecentCall(call: Omit<RecentCall, 'id' | 'timestamp'>) {
  recentCalls = [{ ...call, id: `call-${Date.now()}`, timestamp: Date.now() }, ...recentCalls].slice(0, 100);
  recentListeners.forEach((listener) => listener());
}

export function getRecentCalls() {
  return recentCalls;
}

export function subscribeRecentCalls(listener: () => void) {
  recentListeners.add(listener);
  return () => { recentListeners.delete(listener); };
}
