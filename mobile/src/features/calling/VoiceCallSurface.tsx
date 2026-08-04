import { useEffect, useState } from 'react';
import { BlurView } from 'expo-blur';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { CallService, type CallServiceState } from './CallService';

const LABELS: Record<Exclude<CallServiceState['status'], 'idle'>, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  participant_joined: 'Other participant joined',
  audio_active: 'Audio active',
  ended: 'Call ended',
};

export function VoiceCallSurface() {
  const [state, setState] = useState(CallService.getState());
  useEffect(() => CallService.subscribe(setState), []);
  if (state.status === 'idle') return null;
  return (
    <Modal animationType="fade" onRequestClose={() => void CallService.endCall()} transparent visible>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={65} style={styles.backdrop} tint="light">
        <SafeAreaView style={styles.safe}><View style={styles.card}>
          <Text style={styles.eyebrow}>VOICE CALL</Text>
          <View style={styles.orb}><Text style={styles.wave}>|||</Text></View>
          <Text accessibilityLiveRegion="polite" style={styles.status}>{LABELS[state.status]}</Text>
          {state.callCode ? <><Text style={styles.codeLabel}>TEMPORARY CALL CODE</Text><Text selectable style={styles.code}>{state.callCode}</Text></> : null}
          <Pressable accessibilityRole="button" disabled={state.status === 'ended'} onPress={() => void CallService.endCall()} style={[styles.end, state.status === 'ended' && styles.disabled]}><Text style={styles.endText}>End Call</Text></Pressable>
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
  codeLabel: { color: '#667085', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 24 },
  code: { color: '#075BFF', fontSize: 25, fontWeight: '900', letterSpacing: 2, marginTop: 5 },
  end: { alignItems: 'center', backgroundColor: '#D92D20', borderRadius: 26, marginTop: 34, minWidth: 160, paddingHorizontal: 24, paddingVertical: 15 },
  endText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, disabled: { opacity: 0.45 },
});
