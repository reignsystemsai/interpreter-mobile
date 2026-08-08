import { useEffect, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
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
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={55} style={styles.backdrop} tint="dark">
        <SafeAreaView style={styles.safe}>
          <LinearGradient colors={['rgba(55,125,255,0.55)', 'rgba(135,107,255,0.55)']} end={{ x: 1, y: 1 }} start={{ x: 0, y: 0 }} style={styles.cardBorder}>
            <View style={styles.card}>
              <Text style={styles.eyebrow}>{isIncoming ? 'INCOMING SPEAK CALL' : 'SPEAK CALL'}</Text>
              <LinearGradient colors={[colors.blue, colors.violet]} end={{ x: 1, y: 1 }} start={{ x: 0, y: 0 }} style={styles.avatarRing}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
              </LinearGradient>
              {state.remoteLabel ? <Text style={styles.remote}>{state.remoteLabel}</Text> : null}
              <Text accessibilityLiveRegion="polite" style={styles.status}>{LABELS[state.status]}</Text>
              {connectedAt.current ? <Text style={styles.duration}>{formatDuration(duration)}</Text> : null}
              {isIncoming ? <View style={styles.incomingActions}>
                <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.declineIncomingCall()} style={styles.decline}><Text style={styles.actionText}>Decline</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.acceptIncomingCall()} style={styles.accept}><Text style={styles.actionText}>Accept</Text></Pressable>
              </View> : <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.endCall()} style={styles.end}><Text style={styles.endText}>End Call</Text></Pressable>}
            </View>
          </LinearGradient>
        </SafeAreaView>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(2,3,8,0.34)', flex: 1 },
  safe: { flex: 1, justifyContent: 'center', padding: 22 },
  cardBorder: { borderRadius: 35, padding: 1.4 },
  card: { alignItems: 'center', backgroundColor: 'rgba(8,10,22,0.88)', borderRadius: 34, paddingHorizontal: 24, paddingVertical: 38 },
  eyebrow: { color: colors.cyan, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  avatarRing: { borderRadius: 56, marginTop: 28, padding: 2 },
  avatar: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 54, height: 104, justifyContent: 'center', width: 104 },
  avatarText: { color: colors.text, fontSize: 40, fontWeight: '800' },
  remote: { color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 22, textAlign: 'center' },
  status: { color: colors.textMuted, fontSize: 16, marginTop: 8, textAlign: 'center' },
  duration: { color: colors.textMuted, fontSize: 15, fontVariant: ['tabular-nums'], marginTop: 8 },
  incomingActions: { flexDirection: 'row', gap: 14, marginTop: 32, width: '100%' },
  accept: { alignItems: 'center', backgroundColor: '#12B76A', borderRadius: 26, flex: 1, paddingVertical: 15 },
  decline: { alignItems: 'center', backgroundColor: '#D92D20', borderRadius: 26, flex: 1, paddingVertical: 15 },
  actionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  end: { alignItems: 'center', backgroundColor: '#D92D20', borderRadius: 26, marginTop: 34, minWidth: 160, paddingHorizontal: 24, paddingVertical: 15 },
  endText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
