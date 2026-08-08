import { useEffect, useState } from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { CallService, type CallState } from './CallService';

const LABELS: Record<Exclude<CallState['status'], 'idle'>, string> = {
  ringing: 'Ringing…',
  connecting: 'Connecting…',
  connected: 'Connected',
  ended: 'Call ended',
};

export function CallOverlay() {
  const [state, setState] = useState(CallService.getState());
  useEffect(() => CallService.subscribe(setState), []);
  useEffect(() => CallService.startPolling(), []);

  if (state.status === 'idle') return null;
  const isIncoming = state.role === 'recipient' && state.status === 'ringing';

  return (
    <Modal animationType="fade" onRequestClose={() => void CallService.endCall()} transparent visible>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.label}>{isIncoming ? 'Incoming call' : 'Call'}</Text>
          <Text style={styles.remote}>{state.remoteLabel || 'Unknown'}</Text>
          <Text style={styles.status}>{LABELS[state.status]}</Text>
          {isIncoming ? (
            <View style={styles.row}>
              <Pressable accessibilityRole="button" onPress={() => void CallService.declineCall()} style={styles.decline}><Text style={styles.buttonText}>Decline</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => void CallService.acceptCall()} style={styles.accept}><Text style={styles.buttonText}>Accept</Text></Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => void CallService.endCall()} style={styles.end}><Text style={styles.buttonText}>End Call</Text></Pressable>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.85)', flex: 1, justifyContent: 'center' },
  card: { alignItems: 'center', padding: 24, width: '100%' },
  label: { color: '#9AA5B1', fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  remote: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  status: { color: '#9AA5B1', fontSize: 16, marginTop: 8 },
  row: { flexDirection: 'row', gap: 16, marginTop: 40, width: '100%' },
  accept: { alignItems: 'center', backgroundColor: '#1F9D55', borderRadius: 12, flex: 1, paddingVertical: 16 },
  decline: { alignItems: 'center', backgroundColor: '#C0392B', borderRadius: 12, flex: 1, paddingVertical: 16 },
  end: { alignItems: 'center', backgroundColor: '#C0392B', borderRadius: 12, marginTop: 40, minWidth: 160, paddingHorizontal: 24, paddingVertical: 16 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
