import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { SpeakBottomBar, SpeakMark } from '../../components/SpeakNavigation';
import { speakCallEngine, type SpeakCallState } from './SpeakCallEngine';

const BLUE = '#145CF6';
const WHITE = '#FFFFFF';

const LABELS: Record<Exclude<SpeakCallState['status'], 'idle'>, string> = {
  calling: 'Calling…',
  ringing: 'Ringing…',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  connected: 'Connected',
  ending: 'Ending…',
  ended: 'Call ended',
  failed: 'Call failed',
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function Control({ active = false, disabled = false, label, onPress }: { active?: boolean; disabled?: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.control, active && styles.controlActive, disabled && styles.disabled, pressed && styles.pressed]}><Text style={[styles.controlText, active && styles.controlTextActive]}>{label}</Text></Pressable>;
}

export function VoiceCallSurface() {
  const [state, setState] = useState(speakCallEngine.getState());
  const [duration, setDuration] = useState(0);
  const connectedAt = useRef<number | null>(null);

  useEffect(() => speakCallEngine.subscribe(setState), []);
  useEffect(() => {
    if (state.status === 'connected') connectedAt.current ??= Date.now();
    if (['idle', 'ending', 'ended', 'failed'].includes(state.status)) {
      connectedAt.current = null;
      setDuration(0);
      return;
    }
    if (!connectedAt.current) return;
    const update = () => setDuration(Math.floor((Date.now() - (connectedAt.current ?? Date.now())) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [state.status]);

  if (state.status === 'idle') return null;
  const incoming = state.role === 'recipient' && state.status === 'ringing';
  const connected = ['connected', 'reconnecting'].includes(state.status);
  const initial = (state.remoteLabel || 'S').trim().slice(0, 1).toUpperCase();
  const outgoingLabel = LABELS[state.status];
  const callLabel = 'Speak Call';

  const terminal = state.status === 'ended' || state.status === 'failed';

  return <Modal animationType="fade" onRequestClose={() => void (terminal ? speakCallEngine.dismiss() : speakCallEngine.endCall())} visible>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><SpeakMark compact /><Text style={styles.contactName}>{state.remoteLabel || 'Speak contact'}</Text><Text style={styles.status}>{outgoingLabel}</Text><Text style={styles.timer}>{connectedAt.current ? formatDuration(duration) : callLabel}</Text></View>

      <View style={styles.stage}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
        <Text style={styles.name}>{state.remoteLabel || 'Speak contact'}</Text>
      </View>

      {incoming ? <View style={styles.incomingActions}>
        <Pressable onPress={() => void speakCallEngine.declineCall()} style={[styles.roundAction, styles.decline]}><Text style={styles.actionText}>Decline</Text></Pressable>
        <Pressable onPress={() => void speakCallEngine.answerCall()} style={[styles.roundAction, styles.answer]}><Text style={styles.actionText}>Answer</Text></Pressable>
      </View> : <>
        <View style={styles.controls}>
          <Control active={state.muted} disabled={!connected} label={state.muted ? 'Unmute' : 'Mute'} onPress={() => void speakCallEngine.toggleMute()} />
          <Control active={state.speakerEnabled} disabled={!connected} label="Speaker" onPress={() => void speakCallEngine.toggleSpeaker()} />
        </View>
        <Pressable onPress={() => void (terminal ? speakCallEngine.dismiss() : speakCallEngine.endCall())} style={styles.end}><Text style={styles.endText}>{terminal ? 'Close' : 'End Call'}</Text></Pressable>
      </>}
      <SpeakBottomBar onHome={() => undefined} onSpeak={() => undefined} onUtilities={() => void speakCallEngine.toggleSpeaker()} />
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: '#020713', flex: 1 },
  header: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 2 },
  contactName: { color: BLUE, fontSize: 23, fontWeight: '800', marginTop: 2 },
  status: { color: '#4EAFFF', fontSize: 15, fontWeight: '700' },
  timer: { color: '#8BA6C9', fontSize: 13, marginTop: 4 },
  stage: { alignItems: 'center', backgroundColor: '#041027', borderColor: 'rgba(62,157,255,0.32)', borderRadius: 34, borderWidth: 1, flex: 1, justifyContent: 'center', margin: 22, overflow: 'hidden', shadowColor: '#19D7FF', shadowOpacity: 0.22, shadowRadius: 22 },
  avatar: { alignItems: 'center', borderColor: '#19D7FF', borderRadius: 78, borderWidth: 2, height: 156, justifyContent: 'center', shadowColor: '#19D7FF', shadowOpacity: 0.62, shadowRadius: 22, width: 156 },
  avatarText: { color: '#4EAFFF', fontSize: 62, fontWeight: '600' },
  name: { color: '#F8FBFF', fontSize: 26, fontWeight: '700', marginTop: 22 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', paddingHorizontal: 22, paddingTop: 16 },
  control: { alignItems: 'center', backgroundColor: 'rgba(7,23,51,0.72)', borderColor: 'rgba(62,157,255,0.3)', borderRadius: 24, borderWidth: 1, justifyContent: 'center', minHeight: 52, minWidth: 82, paddingHorizontal: 15 },
  controlActive: { backgroundColor: '#075BFF', borderColor: '#19D7FF', shadowColor: '#19D7FF', shadowOpacity: 0.4, shadowRadius: 9 },
  controlText: { color: '#A9D3FF', fontSize: 13, fontWeight: '700' },
  controlTextActive: { color: WHITE },
  end: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#E53935', borderRadius: 27, justifyContent: 'center', marginBottom: 18, marginTop: 16, minHeight: 54, width: '62%' },
  endText: { color: WHITE, fontSize: 17, fontWeight: '700' },
  incomingActions: { flexDirection: 'row', justifyContent: 'space-around', paddingBottom: 44, paddingHorizontal: 30 },
  roundAction: { alignItems: 'center', borderRadius: 42, height: 84, justifyContent: 'center', width: 84 },
  decline: { backgroundColor: '#E53935' },
  answer: { backgroundColor: '#16A34A' },
  actionText: { color: WHITE, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.7 },
});
