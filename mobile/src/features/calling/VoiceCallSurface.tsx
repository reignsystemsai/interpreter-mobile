import { useEffect, useState } from 'react';
import { BlurView } from 'expo-blur';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { VoiceCallService, type VoiceCallState } from './VoiceCallService';

const LABELS: Record<Exclude<VoiceCallState['status'], 'idle'>, string> = {
  preparing: 'Preparing call',
  ringing: 'Ringing',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  connected: 'Connected',
  ending: 'Ending call',
  ended: 'Call ended',
  failed: 'Call Failed',
};

export function VoiceCallSurface() {
  const [state, setState] = useState(VoiceCallService.getState());
  useEffect(() => VoiceCallService.subscribe(setState), []);
  if (state.status === 'idle') return null;
  const isIncoming = state.role === 'recipient' && state.status === 'ringing';
  return (
    <Modal animationType="fade" onRequestClose={() => void VoiceCallService.endCall()} transparent visible>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={65} style={styles.backdrop} tint="light">
        <SafeAreaView style={styles.safe}><View style={styles.card}>
          <Text style={styles.eyebrow}>{isIncoming ? 'INCOMING VOICE CALL' : 'VOICE CALL'}</Text>
          <View style={styles.orb}><Text style={styles.wave}>|||</Text></View>
          <Text accessibilityLiveRegion="polite" style={styles.status}>{LABELS[state.status]}</Text>
          {state.remoteLabel ? <Text style={styles.remote}>{state.remoteLabel}</Text> : null}
          {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
          {isIncoming ? <View style={styles.incomingActions}>
            <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.declineIncomingCall()} style={styles.decline}><Text style={styles.actionText}>Decline</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.acceptIncomingCall()} style={styles.accept}><Text style={styles.actionText}>Accept</Text></Pressable>
          </View> : <>
            {state.status === 'connected' ? <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.toggleMute()} style={styles.mute}><Text style={styles.muteText}>{state.muted ? 'Unmute' : 'Mute'}</Text></Pressable> : null}
            <Pressable accessibilityRole="button" onPress={() => void VoiceCallService.endCall()} style={styles.end}><Text style={styles.endText}>End Call</Text></Pressable>
          </>}
        </View></SafeAreaView>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 }, safe: { flex: 1, justifyContent: 'center', padding: 22 },
  card: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.36)', borderRadius: 34, paddingHorizontal: 24, paddingVertical: 38 },
  eyebrow: { color: '#075BFF', fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  orb: { alignItems: 'center', backgroundColor: 'rgba(234,241,255,0.78)', borderRadius: 54, height: 108, justifyContent: 'center', marginTop: 28, width: 108 },
  wave: { color: '#075BFF', fontSize: 28, fontWeight: '900', letterSpacing: 3 },
  status: { color: '#101828', fontSize: 22, fontWeight: '800', marginTop: 22, textAlign: 'center' },
  remote: { color: '#475467', fontSize: 16, marginTop: 8, textAlign: 'center' },
  error: { color: '#B42318', fontSize: 14, lineHeight: 20, marginTop: 12, textAlign: 'center' },
  incomingActions: { flexDirection: 'row', gap: 14, marginTop: 32, width: '100%' },
  accept: { alignItems: 'center', backgroundColor: '#12B76A', borderRadius: 26, flex: 1, paddingVertical: 15 },
  decline: { alignItems: 'center', backgroundColor: '#D92D20', borderRadius: 26, flex: 1, paddingVertical: 15 },
  actionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  mute: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.68)', borderRadius: 22, marginTop: 26, minWidth: 130, paddingVertical: 12 },
  muteText: { color: '#075BFF', fontSize: 15, fontWeight: '700' },
  end: { alignItems: 'center', backgroundColor: '#D92D20', borderRadius: 26, marginTop: 34, minWidth: 160, paddingHorizontal: 24, paddingVertical: 15 },
  endText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
