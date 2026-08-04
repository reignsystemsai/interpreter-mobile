export type CallType = 'voice' | 'video' | 'business_video';
export type CallStatus = 'ringing' | 'accepted' | 'active' | 'declined' | 'ended' | 'missed' | 'busy' | 'failed' | 'canceled';
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export type CallRecord = {
  id: string;
  roomName: string;
  callerId: string;
  calleeId: string;
  contactId: string | null;
  callType: CallType;
  status: CallStatus;
  ringingAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  declineReason: string | null;
  interpretation: {
    enabled: boolean;
    callerSpokenLanguage: string;
    callerHeardLanguage: string;
    calleeSpokenLanguage: string;
    calleeHeardLanguage: string;
    startedAt: string | null;
    endedAt: string | null;
    interpretedSeconds: number;
  };
  createdAt: string;
  updatedAt: string;
  otherParty: { userId: string; displayName: string; phone: string | null };
};

export type PresenceStatus = 'online' | 'offline' | 'available' | 'busy' | 'ringing' | 'in_call';
export type PresenceRecord = { userId: string; status: PresenceStatus; lastSeenAt: string };
