import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Linking, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { VideoView } from '@livekit/react-native';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

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

async function openExternal(kind: 'sms', recipient: string) {
  const url = `${kind}:${encodeURIComponent(recipient)}`;
  if (await Linking.canOpenURL(url)) {
    await Linking.openURL(url);
    return;
  }
  Alert.alert('Messages unavailable');
}

type ControlName = 'bluetooth' | 'message' | 'microphone' | 'speaker' | 'video';

function ControlIcon({ name }: { name: ControlName }) {
  if (name === 'bluetooth') return <Svg height={27} viewBox="0 0 24 24" width={27}><Path d="m7 7 10 10-5 4V3l5 4L7 17" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  if (name === 'microphone') return <Svg height={27} viewBox="0 0 24 24" width={27}><Rect fill="none" height={11} rx={4} stroke="#FFFFFF" strokeWidth={1.8} width={7} x={8.5} y={2.5} /><Path d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M8.5 21h7" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeWidth={1.8} /></Svg>;
  if (name === 'speaker') return <Svg height={27} viewBox="0 0 24 24" width={27}><Path d="M4 10v4h4l5 4V6l-5 4H4Z" fill="none" stroke="#FFFFFF" strokeLinejoin="round" strokeWidth={1.8} /><Path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeWidth={1.8} /></Svg>;
  if (name === 'video') return <Svg height={27} viewBox="0 0 24 24" width={27}><Rect fill="none" height={12} rx={3} stroke="#FFFFFF" strokeWidth={1.8} width={13} x={2.5} y={6} /><Path d="m15.5 10 4-2.3c.8-.4 1.7.1 1.7 1v6.6c0 .9-.9 1.4-1.7 1l-4-2.3v-4Z" fill="none" stroke="#FFFFFF" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  return <Svg height={27} viewBox="0 0 24 24" width={27}><Path d="M4 4.5h16v11H9l-5 4v-15Z" fill="none" stroke="#FFFFFF" strokeLinejoin="round" strokeWidth={1.8} /><Line stroke="#FFFFFF" strokeLinecap="round" strokeWidth={1.8} x1="8" x2="16" y1="9" y2="9" /><Line stroke="#FFFFFF" strokeLinecap="round" strokeWidth={1.8} x1="8" x2="13" y1="12" y2="12" /></Svg>;
}

function PhoneIcon({ answered = false }: { answered?: boolean }) {
  return <Svg height={31} viewBox="0 0 24 24" width={31}><Path d="M6.7 3.1 9 2.5c.7-.2 1.4.2 1.7.9l1 2.8c.2.6 0 1.2-.5 1.6L9.7 9a14.5 14.5 0 0 0 5.3 5.3l1.2-1.5c.4-.5 1-.7 1.6-.5l2.8 1c.7.3 1.1 1 1 1.7l-.6 2.3a3 3 0 0 1-3 2.3A15.4 15.4 0 0 1 4.4 6a3 3 0 0 1 2.3-2.9Z" fill="#FFFFFF" transform={answered ? 'rotate(-18 12 12)' : 'rotate(135 12 12)'} /></Svg>;
}

function Control({ disabled = false, icon, label, onPress, selected = false }: { disabled?: boolean; icon: ControlName; label: string; onPress: () => void; selected?: boolean }) {
  return <View style={styles.controlItem}><Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.control, selected && styles.controlSelected, disabled && styles.previewDisabled, pressed && styles.pressed]}><ControlIcon name={icon} /></Pressable><Text style={styles.controlText}>{label}</Text></View>;
}

function CallAction({ answered = false, disabled = false, label, onPress, tone }: { answered?: boolean; disabled?: boolean; label: string; onPress: () => void; tone: 'green' | 'red' }) {
  return <View style={styles.actionItem}><Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionCircle, tone === 'green' ? styles.actionGreen : styles.actionRed, pressed && styles.pressed]}><PhoneIcon answered={answered} /></Pressable><Text style={styles.actionText}>{label}</Text></View>;
}

export function CallScreen({ preview = false, state }: { preview?: boolean; state: CallState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.connectedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [state.connectedAt]);
  const noop = () => undefined;
  const action = (callback: () => void) => preview ? noop : callback;
  const incoming = state.role === 'recipient' && state.status === 'ringing';
  const remote = state.remoteLabel || 'Unknown caller';
  const remotePhone = state.remotePhone;
  const roomConnected = state.status === 'connected' || state.status === 'reconnecting';
  const previewVideo = preview && state.cameraEnabled;
  const statusLabel = state.status === 'idle' ? '' : LABELS[state.status];

  return (
    <SafeAreaView style={styles.backdrop}>
      <View style={styles.screen}>
        {state.remoteVideoTrack ? <VideoView objectFit="cover" style={styles.remoteVideo} videoTrack={state.remoteVideoTrack} /> : previewVideo ? <View style={styles.previewRemoteVideo}><Text style={styles.previewVideoText}>Remote video area</Text></View> : <View style={styles.audioBackdrop} />}
        <View style={styles.content}>
          <Text style={styles.label}>{incoming ? 'Incoming Interpreter Call' : statusLabel}</Text>
          <Text numberOfLines={1} style={styles.remote}>{remote}</Text>
          <Text style={styles.status}>{state.connectedAt ? durationLabel(state.connectedAt, now) : statusLabel}</Text>
          {state.localVideoTrack ? <VideoView mirror={state.cameraFacingMode === 'user'} objectFit="cover" style={styles.localVideo} videoTrack={state.localVideoTrack} /> : previewVideo ? <View style={styles.previewLocalVideo}><Text style={styles.previewLocalText}>Local preview</Text></View> : null}
          {incoming ? (
            <View style={styles.incomingRow}>
              <CallAction disabled={preview} label="Decline" onPress={action(() => void CallService.declineCall().catch((error) => Alert.alert('Unable to decline', error instanceof Error ? error.message : 'Please try again.')))} tone="red" />
              <CallAction answered disabled={preview} label="Answer" onPress={action(() => void CallService.acceptCall().catch((error) => Alert.alert('Unable to answer', error instanceof Error ? error.message : 'Please try again.')))} tone="green" />
            </View>
          ) : (
            <View style={styles.controlsArea}>
              <View style={styles.grid}>
                <Control disabled={preview || !roomConnected} icon="microphone" label={state.muted ? 'Unmute' : 'Mute'} onPress={action(() => void CallService.toggleMute().catch((error) => Alert.alert('Mute unavailable', error instanceof Error ? error.message : 'Unable to change mute.')))} selected={state.muted} />
                <Control disabled={preview || !roomConnected} icon="speaker" label="Speaker" onPress={action(() => void CallService.toggleSpeaker().catch((error) => Alert.alert('Speaker unavailable', error instanceof Error ? error.message : 'Unable to change speaker.')))} selected={state.speakerEnabled} />
                <Control disabled={preview || !roomConnected} icon="bluetooth" label="Bluetooth" onPress={action(() => void CallService.chooseBluetooth().catch((error) => Alert.alert('Bluetooth unavailable', error instanceof Error ? error.message : 'Unable to select Bluetooth.')))} />
                <Control disabled={preview || !roomConnected} icon="video" label={state.cameraEnabled ? 'Video Off' : 'Video'} onPress={action(() => void CallService.toggleCamera().catch((error) => Alert.alert('Video unavailable', error instanceof Error ? error.message : 'Unable to change video.')))} selected={state.cameraEnabled} />
                <Control disabled={preview || !remotePhone} icon="message" label="Message" onPress={action(() => void openExternal('sms', remotePhone).catch(() => Alert.alert('Messages unavailable')))} />
              </View>
              <CallAction disabled={preview} label="End" onPress={action(() => void CallService.endCall().catch((error) => Alert.alert('Unable to end call', error instanceof Error ? error.message : 'Please try again.')))} tone="red" />
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

export function CallOverlay() {
  const state = useSyncExternalStore(
    (listener) => CallService.subscribe(listener),
    () => CallService.getState(),
    () => CallService.getState(),
  );
  useEffect(() => CallService.startPolling(), []);

  if (state.status === 'idle') return null;
  return (
    <View style={styles.overlay}>
      <CallScreen state={state} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, elevation: 1000, zIndex: 1000 },
  backdrop: { backgroundColor: '#0B1220', flex: 1 }, screen: { flex: 1 }, audioBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#14213D' }, remoteVideo: { ...StyleSheet.absoluteFillObject }, previewRemoteVideo: { ...StyleSheet.absoluteFillObject, alignItems: 'center', backgroundColor: '#203A61', justifyContent: 'center' }, previewVideoText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' }, previewLocalVideo: { alignItems: 'center', backgroundColor: '#486A96', borderColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, height: 150, justifyContent: 'center', position: 'absolute', right: 20, top: 82, width: 106 }, previewLocalText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', textAlign: 'center' }, content: { alignItems: 'center', flex: 1, justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 36 }, label: { color: '#B8C4D9', fontSize: 14, fontWeight: '700', marginTop: 18 }, remote: { color: '#FFFFFF', fontSize: 30, fontWeight: '700', marginTop: 12, textAlign: 'center' }, status: { color: '#D5DCE8', fontSize: 16, marginTop: 8 }, localVideo: { borderColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, height: 150, position: 'absolute', right: 20, top: 82, width: 106 }, incomingRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-around', marginBottom: 34, width: '100%' }, controlsArea: { alignItems: 'center', marginBottom: 12, width: '100%' }, grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 22, rowGap: 18, width: '100%' }, controlItem: { alignItems: 'center', width: '33.333%' }, control: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.17)', borderColor: 'rgba(255,255,255,0.28)', borderRadius: 35, borderWidth: 1, height: 70, justifyContent: 'center', width: 70 }, controlSelected: { backgroundColor: '#075BFF', borderColor: 'rgba(255,255,255,0.54)' }, previewDisabled: { opacity: 0.38 }, controlText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', marginTop: 8, textAlign: 'center' }, actionItem: { alignItems: 'center', minWidth: 96 }, actionCircle: { alignItems: 'center', borderColor: 'rgba(255,255,255,0.30)', borderRadius: 39, borderWidth: 1, height: 78, justifyContent: 'center', shadowColor: '#000000', shadowOffset: { height: 7, width: 0 }, shadowOpacity: 0.22, shadowRadius: 12, width: 78 }, actionGreen: { backgroundColor: '#30D158' }, actionRed: { backgroundColor: '#FF453A' }, actionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', marginTop: 9 }, pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
});
