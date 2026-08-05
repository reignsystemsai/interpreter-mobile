import { useEffect, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { VoiceCallService, type VoiceCallState } from './VoiceCallService';

const LABELS: Record<Exclude<VoiceCallState['status'], 'idle'>, string> = {
  preparing: 'Calling…',
  ringing: 'Ringing…',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  connected: 'Connected',
  ending: 'Ending…',
  ended: 'Call ended',
  failed: 'Call Failed',
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function VoiceCallSurface() {
  const [state, setState] = useState(VoiceCallService.getState());
  const [duration, setDuration] = useState(0);
  const connectedAt = useRef<number | null>(null);
  useEffect(() => VoiceCallService.subscribe(setState), []);
  useEffect(() => {
    if (state.status === 'connected') connectedAt.current ??= Date.now();
    if (['idle', 'ending', 'ended', 'failed'].includes(state.status)) {
      connectedAt.current = null;
      setDuration(0);
      return;
    }
    if (!connectedAt.current) return;
    const updateDuration = () => setDuration(Math.floor((Date.now() - (connectedAt.current ?? Date.now())) / 1000));
    updateDuration();
    const interval = setInterval(updateDuration, 1000);
    return () => clearInterval(interval);
  }, [state.status]);
  if (state.status === 'idle') return null;
  const isIncoming = state.role === 'recipient' && state.status === 'ringing';
  const initial = (state.remoteLabel || 'I').trim().slice(0, 1).toUpperCase();
  return (
    <Modal animationType="fade" onRequestClose={() => void VoiceCallService.endCall()} transparent visible>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={65} style={styles.backdrop} tint="light">
        <SafeAreaView style={styles.safe}><View style={styles.card}>
          <Text style={styles.eyebrow}>{isIncoming ? 'INCOMING VOICE CALL' : 'VOICE CALL'}</Text>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
          {state.remoteLabel ? <Text style={styles.remote}>{state.remoteLabel}</Text> : null}
          <Text accessibilityLiveRegion="polite" style={styles.status}>{LABELS[state.status]}</Text>
          {connectedAt.current ? <Text style={styles.duration}>{formatDuration(duration)}</Text> : null}
          {isIncoming ? <View style={styles.incomingActions}>
            <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.declineIncomingCall()} style={styles.decline}><Text style={styles.actionText}>Decline</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.acceptIncomingCall()} style={styles.accept}><Text style={styles.actionText}>Answer</Text></Pressable>
          </View> : <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.endCall()} style={styles.end}><Text style={styles.endText}>End Call</Text></Pressable>}
        </View></SafeAreaView>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 }, safe: { flex: 1, justifyContent: 'center', padding: 22 },
  card: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.36)', borderRadius: 34, paddingHorizontal: 24, paddingVertical: 38 },
  eyebrow: { color: '#075BFF', fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  avatar: { alignItems: 'center', backgroundColor: 'rgba(234,241,255,0.78)', borderRadius: 54, height: 108, justifyContent: 'center', marginTop: 28, width: 108 },
  avatarText: { color: '#075BFF', fontSize: 42, fontWeight: '800' },
  remote: { color: '#101828', fontSize: 24, fontWeight: '800', marginTop: 22, textAlign: 'center' },
  status: { color: '#667085', fontSize: 16, marginTop: 8, textAlign: 'center' },
  duration: { color: '#475467', fontSize: 15, fontVariant: ['tabular-nums'], marginTop: 8 },
  incomingActions: { flexDirection: 'row', gap: 14, marginTop: 32, width: '100%' },
  accept: { alignItems: 'center', backgroundColor: '#12B76A', borderRadius: 26, flex: 1, paddingVertical: 15 },
  decline: { alignItems: 'center', backgroundColor: '#D92D20', borderRadius: 26, flex: 1, paddingVertical: 15 },
  actionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  end: { alignItems: 'center', backgroundColor: '#D92D20', borderRadius: 26, marginTop: 34, minWidth: 160, paddingHorizontal: 24, paddingVertical: 15 },
  endText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
