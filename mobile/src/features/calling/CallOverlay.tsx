import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { VideoView } from '@livekit/react-native';

import { CallService, type CallState } from './CallService';

const LABELS: Record<Exclude<CallState['status'], 'idle'>, string> = {
  ringing: 'Ringing...',
  connecting: 'Connecting...',
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  ended: 'Call ended',
};

function durationLabel(connectedAt: number | null, now: number) {
  if (!connectedAt) return '';
  const seconds = Math.floor((now - connectedAt) / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

async function openExternal(kind: 'facetime' | 'sms', recipient: string) {
  const url = `${kind}:${encodeURIComponent(recipient)}`;
  if (await Linking.canOpenURL(url)) {
    await Linking.openURL(url);
    return;
  }
  Alert.alert(kind === 'sms' ? 'Messages unavailable' : 'FaceTime unavailable');
}

function Control({ label, onPress, selected = false }: { label: string; onPress: () => void; selected?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.control, selected && styles.controlSelected, pressed && styles.pressed]}><Text style={styles.controlText}>{label}</Text></Pressable>;
}

export function CallOverlay() {
  const [state, setState] = useState(CallService.getState());
  const [now, setNow] = useState(Date.now());
  useEffect(() => CallService.subscribe(setState), []);
  useEffect(() => CallService.startPolling(), []);
  useEffect(() => {
    if (!state.connectedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [state.connectedAt]);

  if (state.status === 'idle') return null;
  const incoming = state.role === 'recipient' && state.status === 'ringing';
  const remote = state.remoteLabel || 'Unknown caller';

  return (
    <Modal animationType="fade" onRequestClose={() => void CallService.endCall()} transparent visible>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.screen}>
          {state.remoteVideoTrack ? <VideoView objectFit="cover" style={styles.remoteVideo} videoTrack={state.remoteVideoTrack} /> : <View style={styles.audioBackdrop} />}
          <View style={styles.content}>
            <Text style={styles.label}>{incoming ? 'Incoming Interpreter Call' : LABELS[state.status]}</Text>
            <Text numberOfLines={1} style={styles.remote}>{remote}</Text>
            <Text style={styles.status}>{state.connectedAt ? durationLabel(state.connectedAt, now) : LABELS[state.status]}</Text>
            {state.localVideoTrack ? <VideoView mirror objectFit="cover" style={styles.localVideo} videoTrack={state.localVideoTrack} /> : null}
            {incoming ? (
              <View style={styles.incomingRow}>
                <Pressable accessibilityRole="button" onPress={() => void CallService.declineCall()} style={styles.decline}><Text style={styles.primaryText}>Decline</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => void CallService.acceptCall()} style={styles.answer}><Text style={styles.primaryText}>Answer</Text></Pressable>
              </View>
            ) : (
              <View style={styles.controlsArea}>
                <View style={styles.grid}>
                  <Control label={state.muted ? 'Unmute' : 'Mute'} onPress={() => void CallService.toggleMute().catch((error) => Alert.alert('Mute unavailable', error instanceof Error ? error.message : 'Unable to change mute.'))} selected={state.muted} />
                  <Control label="Speaker" onPress={() => void CallService.toggleSpeaker().catch((error) => Alert.alert('Speaker unavailable', error instanceof Error ? error.message : 'Unable to change speaker.'))} selected={state.speakerEnabled} />
                  <Control label={state.cameraEnabled ? 'Camera Off' : 'Camera'} onPress={() => void CallService.toggleCamera().catch((error) => Alert.alert('Camera unavailable', error instanceof Error ? error.message : 'Unable to change camera.'))} selected={state.cameraEnabled} />
                  <Control label="Message" onPress={() => void openExternal('sms', remote).catch(() => Alert.alert('Messages unavailable'))} />
                  <Control label="FaceTime" onPress={() => void openExternal('facetime', remote).catch(() => Alert.alert('FaceTime unavailable'))} />
                </View>
                <Pressable accessibilityRole="button" onPress={() => void CallService.endCall()} style={styles.end}><Text style={styles.primaryText}>End Call</Text></Pressable>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#0B1220', flex: 1 }, screen: { flex: 1 }, audioBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#14213D' }, remoteVideo: { ...StyleSheet.absoluteFillObject }, content: { alignItems: 'center', flex: 1, justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 36 }, label: { color: '#B8C4D9', fontSize: 14, fontWeight: '700', marginTop: 18 }, remote: { color: '#FFFFFF', fontSize: 30, fontWeight: '700', marginTop: 12, textAlign: 'center' }, status: { color: '#D5DCE8', fontSize: 16, marginTop: 8 }, localVideo: { borderColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, height: 150, position: 'absolute', right: 20, top: 82, width: 106 }, incomingRow: { flexDirection: 'row', gap: 18, marginBottom: 38, width: '100%' }, answer: { alignItems: 'center', backgroundColor: '#1F9D55', borderRadius: 12, flex: 1, paddingVertical: 18 }, decline: { alignItems: 'center', backgroundColor: '#C0392B', borderRadius: 12, flex: 1, paddingVertical: 18 }, controlsArea: { marginBottom: 16, width: '100%' }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, control: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, flexBasis: '30%', flexGrow: 1, minHeight: 58, justifyContent: 'center', paddingHorizontal: 8 }, controlSelected: { backgroundColor: '#075BFF' }, controlText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', textAlign: 'center' }, end: { alignItems: 'center', backgroundColor: '#C0392B', borderRadius: 12, marginTop: 16, minHeight: 58, justifyContent: 'center' }, primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' }, pressed: { opacity: 0.72 },
});
