import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { API_BASE_URL } from '../../config/runtime';
import type { CallVoiceId } from './voiceCatalog';

const PREVIEW_SAMPLE_KEY = 'speak-default-introduction';
const LOAD_TIMEOUT_MS = 12_000;

export type VoicePreviewSide = 'caller' | 'recipient';
export type VoicePreviewStatus = 'idle' | 'loading' | 'playing' | 'stopped' | 'error';

export type VoicePreviewState = {
  error: string;
  side: VoicePreviewSide | null;
  status: VoicePreviewStatus;
  voiceId: CallVoiceId | null;
};

const INITIAL_STATE: VoicePreviewState = { error: '', side: null, status: 'idle', voiceId: null };

export function useVoicePreviewPlayer() {
  const player = useAudioPlayer(null, { downloadFirst: true, updateInterval: 100 });
  const playerStatus = useAudioPlayerStatus(player);
  const [state, setState] = useState<VoicePreviewState>(INITIAL_STATE);
  const generation = useRef(0);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoadTimer = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = null;
  }, []);

  const releaseCurrent = useCallback(() => {
    generation.current += 1;
    clearLoadTimer();
    try { player.pause(); } catch { /* The player may not have loaded a source yet. */ }
    try { player.replace(null); } catch { /* The hook still releases the player on unmount. */ }
  }, [clearLoadTimer, player]);

  const stopPreview = useCallback(() => {
    releaseCurrent();
    setState((current) => ({ ...current, error: '', status: current.side ? 'stopped' : 'idle' }));
  }, [releaseCurrent]);

  const togglePreview = useCallback(async (side: VoicePreviewSide, voiceId: CallVoiceId) => {
    if (state.side === side && state.voiceId === voiceId && (state.status === 'loading' || state.status === 'playing')) {
      stopPreview();
      return;
    }

    releaseCurrent();
    const requestGeneration = generation.current;
    setState({ error: '', side, status: 'loading', voiceId });
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/voices/preview`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId, sampleKey: PREVIEW_SAMPLE_KEY }),
      });
      const payload = (await response.json().catch(() => ({}))) as { previewUrl?: string };
      if (!response.ok || !payload.previewUrl) throw new Error('preview_unavailable');
      if (generation.current !== requestGeneration) return;
      const previewUrl = payload.previewUrl.startsWith('http') ? payload.previewUrl : `${API_BASE_URL}${payload.previewUrl}`;
      player.replace({ uri: previewUrl });
      loadTimer.current = setTimeout(() => {
        if (generation.current !== requestGeneration) return;
        releaseCurrent();
        setState({ error: 'Preview unavailable. Try again.', side, status: 'error', voiceId });
      }, LOAD_TIMEOUT_MS);
    } catch {
      if (generation.current !== requestGeneration) return;
      releaseCurrent();
      setState({ error: 'Preview unavailable. Try again.', side, status: 'error', voiceId });
    }
  }, [player, releaseCurrent, state.side, state.status, state.voiceId, stopPreview]);

  useEffect(() => {
    if (state.status !== 'loading' || !playerStatus.isLoaded) return;
    clearLoadTimer();
    player.play();
    setState((current) => current.status === 'loading' ? { ...current, status: 'playing' } : current);
  }, [clearLoadTimer, player, playerStatus.isLoaded, state.status]);

  useEffect(() => {
    if (!playerStatus.didJustFinish) return;
    stopPreview();
  }, [playerStatus.didJustFinish, stopPreview]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') stopPreview();
    });
    return () => subscription.remove();
  }, [stopPreview]);

  useEffect(() => () => {
    releaseCurrent();
  }, [releaseCurrent]);

  return { state, stopPreview, togglePreview };
}
