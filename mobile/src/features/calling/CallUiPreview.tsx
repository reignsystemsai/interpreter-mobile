import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { type CallState } from './CallService';
import { CallScreen } from './CallOverlay';

type PreviewMode = 'incoming' | 'audio' | 'video';

function stateFor(mode: PreviewMode): CallState {
  return {
    cameraEnabled: mode === 'video',
    cameraFacingMode: 'user',
    callId: 'call-ui-preview',
    connectedAt: mode === 'incoming' ? null : Date.now() - 72_000,
    error: '',
    localVideoTrack: null,
    muted: false,
    remoteLabel: '+1 555 010 0200',
    remotePhone: '+15550100200',
    remoteVideoTrack: null,
    role: mode === 'incoming' ? 'recipient' : 'caller',
    speakerEnabled: false,
    status: mode === 'incoming' ? 'ringing' : 'connected',
  };
}

export function CallUiPreview({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<PreviewMode>('incoming');
  return <Modal animationType="slide" onRequestClose={onClose} visible>
    <View style={styles.page}>
      <View style={styles.toolbar}>
        <Text style={styles.title}>CALL UI PREVIEW</Text>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable>
      </View>
      <View style={styles.tabs}>
        {(['incoming', 'audio', 'video'] as const).map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => setMode(item)} style={[styles.tab, mode === item && styles.tabActive]}><Text style={[styles.tabText, mode === item && styles.tabTextActive]}>{item === 'incoming' ? 'Incoming' : item === 'audio' ? 'Connected Audio' : 'Connected Video'}</Text></Pressable>)}
      </View>
      <View style={styles.preview}><CallScreen preview state={stateFor(mode)} /></View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#F8FBFF', flex: 1 }, toolbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 18 }, title: { color: '#101828', fontSize: 15, fontWeight: '800' }, close: { padding: 8 }, closeText: { color: '#075BFF', fontSize: 16, fontWeight: '700' }, tabs: { flexDirection: 'row', gap: 8, padding: 14 }, tab: { borderColor: '#DDE5F1', borderRadius: 8, borderWidth: 1, flex: 1, paddingVertical: 10 }, tabActive: { backgroundColor: '#075BFF', borderColor: '#075BFF' }, tabText: { color: '#344054', fontSize: 12, fontWeight: '700', textAlign: 'center' }, tabTextActive: { color: '#FFFFFF' }, preview: { flex: 1 },
});
