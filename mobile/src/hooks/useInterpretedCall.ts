import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client';

import { authenticatedRequest } from '../services/api';
import { configureMembership } from '../services/membership';
import { useAuth } from '../features/account/AuthProvider';
import { friendlyCallMessage } from '../features/calling/callMessages';
import type { CallRecord, ConnectionStatus } from '../features/calling/types';

type TranscriptTurn = {
  sourceLanguage: string;
  targetLanguage: string;
  sourceUserId: string;
  original: string;
  translation: string;
  utteranceId: string;
};

type InterpretationState = 'idle' | 'connecting' | 'active' | 'reconnecting' | 'degraded' | 'unavailable';

export function useInterpretedCall({ call, connectionStatus, room }: { call: CallRecord | null; connectionStatus: ConnectionStatus; room: Room | null }) {
  const { user } = useAuth();
  const [state, setState] = useState<InterpretationState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [latencies, setLatencies] = useState<number[]>([]);
  const startedCallId = useRef<string | null>(null);
  const rawAudioFallback = useRef(true);
  const retryAttempts = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryable = useRef(true);
  const statusFailures = useRef(0);

  const setRawAudioFallback = useCallback((enabled: boolean) => {
    rawAudioFallback.current = enabled;
    if (!room || !user) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        const bridgeTrack = participant.identity.startsWith('interpreter-bridge-');
        const intendedTranslation = bridgeTrack && publication.trackName === `interpreter-to-${user.id}`;
        publication.setSubscribed(intendedTranslation || (!bridgeTrack && enabled));
      }
    }
  }, [room, user]);

  const startInterpretation = useCallback(async () => {
    if (!call || !room || !user || !['accepted', 'active'].includes(call.status)) return;
    setState('connecting');
    setError(null);
    await configureMembership(user.id).catch(() => false);
    const isCaller = call.callerId === user.id;
    const spokenLanguage = isCaller ? call.interpretation.callerSpokenLanguage : call.interpretation.calleeSpokenLanguage;
    const heardLanguage = isCaller ? call.interpretation.callerHeardLanguage : call.interpretation.calleeHeardLanguage;
    try {
      const result = await authenticatedRequest<{ interpretation: { active: boolean; status: string } }>(`/api/v1/interpreted-calls/${call.id}/start`, {
        method: 'POST',
        body: JSON.stringify({ spokenLanguage, heardLanguage }),
      });
      startedCallId.current = call.id;
      setRawAudioFallback(!result.interpretation.active);
      setState(result.interpretation.active ? 'active' : 'connecting');
      if (result.interpretation.active) retryAttempts.current = 0;
    } catch (startError) {
      setState('unavailable');
      setError(friendlyCallMessage(startError, 'The translation service is temporarily unavailable.'));
      retryAttempts.current += 1;
      retryable.current = true;
      setRawAudioFallback(true);
    }
  }, [call, room, setRawAudioFallback, user]);

  useEffect(() => {
    if (!room || !user || !call) return;
    const applySubscription = (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (publication.kind === Track.Kind.Video) {
        publication.setSubscribed(true);
        return;
      }
      if (publication.kind !== Track.Kind.Audio) return;
      const bridgeTrack = participant.identity.startsWith('interpreter-bridge-');
      const intendedTranslation = bridgeTrack && publication.trackName === `interpreter-to-${user.id}`;
      publication.setSubscribed(intendedTranslation || (!bridgeTrack && rawAudioFallback.current));
    };
    const handleTrackPublished = (publication: RemoteTrackPublication, participant: RemoteParticipant) => applySubscription(publication, participant);
    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) applySubscription(publication, participant);
    }
    return () => { room.off(RoomEvent.TrackPublished, handleTrackPublished); };
  }, [call, room, user]);

  useEffect(() => {
    if (!room || !call) return;
    const handleData = (payload: Uint8Array, _participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== 'interpreter.call') return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(decodeData(payload)); } catch { return; }
      if (event.callId !== call.id) return;
      if (event.type === 'interpretation.status') {
        const status = String(event.status || '');
        if (['bridge_ready', 'openai_connected'].includes(status)) {
          setState('active');
          setError(null);
          retryAttempts.current = 0;
          retryable.current = true;
          setRawAudioFallback(false);
        }
        else if (status.includes('reconnecting')) { retryable.current = true; setState('reconnecting'); }
        else if (status === 'allowance_exhausted') {
          setState('unavailable');
          setError('Your interpreted-minute allowance is exhausted.');
          retryable.current = false;
          setRawAudioFallback(true);
        }
        else if (status === 'openai_unavailable') {
          retryable.current = true;
          setState('unavailable');
          setError('The translation service is temporarily unavailable.');
          setRawAudioFallback(true);
        }
        else if (status === 'degraded' || status.includes('disconnected')) { retryable.current = true; setState('degraded'); }
      } else if (event.type === 'interpretation.metric' && typeof event.firstAudioLatencyMs === 'number') {
        setLatencies((current) => [...current.slice(-19), event.firstAudioLatencyMs as number]);
      } else if (event.type === 'interpretation.transcript' && typeof event.utteranceId === 'string') {
        setTurns((current) => {
          const existing = current.find((turn) => turn.utteranceId === event.utteranceId);
          const text = String(event.text || '');
          const kind = event.kind === 'translation' ? 'translation' : 'original';
          const next = existing
            ? current.map((turn) => turn.utteranceId === event.utteranceId ? { ...turn, [kind]: event.final ? text : `${turn[kind]}${text}` } : turn)
            : [...current, {
              sourceLanguage: String(event.sourceLanguage || ''), targetLanguage: String(event.targetLanguage || ''),
              sourceUserId: String(event.sourceUserId || ''), utteranceId: event.utteranceId as string,
              original: kind === 'original' ? text : '', translation: kind === 'translation' ? text : '',
            }];
          return next.slice(-4);
        });
      }
    };
    room.on(RoomEvent.DataReceived, handleData);
    return () => { room.off(RoomEvent.DataReceived, handleData); };
  }, [call, room, setRawAudioFallback]);

  useEffect(() => {
    if (!call || !room || connectionStatus !== 'connected' || startedCallId.current === call.id) return;
    void startInterpretation();
  }, [call, connectionStatus, room, startInterpretation]);

  useEffect(() => {
    if (!call || !room || connectionStatus !== 'connected' || !startedCallId.current) return;
    const checkStatus = async () => {
      try {
        const result = await authenticatedRequest<{ interpretation: { active: boolean; status: string } }>(`/api/v1/interpreted-calls/${call.id}/status`);
        statusFailures.current = 0;
        if (result.interpretation.active) {
          retryAttempts.current = 0;
          retryable.current = true;
          setError(null);
          setState('active');
          setRawAudioFallback(false);
        } else if (result.interpretation.status === 'stopped' && state === 'active') {
          retryable.current = true;
          setState('degraded');
          setRawAudioFallback(true);
        }
      } catch {
        statusFailures.current += 1;
        if (statusFailures.current >= 2 && state === 'active') {
          retryable.current = true;
          setState('degraded');
          setRawAudioFallback(true);
        }
      }
    };
    const timer = setInterval(() => void checkStatus(), 5_000);
    return () => clearInterval(timer);
  }, [call, connectionStatus, room, setRawAudioFallback, state]);

  useEffect(() => {
    if (connectionStatus === 'reconnecting' && startedCallId.current) setState('reconnecting');
    if (connectionStatus !== 'connected' || !retryable.current || !['reconnecting', 'degraded', 'unavailable'].includes(state) || retryAttempts.current >= 4) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const delay = Math.min(8_000, 750 * (2 ** retryAttempts.current));
    retryTimer.current = setTimeout(() => void startInterpretation(), delay);
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, [connectionStatus, startInterpretation, state]);

  useEffect(() => {
    startedCallId.current = null;
    setTurns([]);
    setLatencies([]);
    rawAudioFallback.current = true;
    retryAttempts.current = 0;
    retryable.current = true;
    statusFailures.current = 0;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    setState('idle');
    setError(null);
  }, [call?.id]);

  return useMemo(() => ({
    averageLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
    error,
    retry: async () => {
      retryAttempts.current = 0;
      retryable.current = true;
      await startInterpretation();
    },
    state,
    turns,
  }), [error, latencies, startInterpretation, state, turns]);
}

function decodeData(payload: Uint8Array) {
  return decodeURIComponent(Array.from(payload, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
}
