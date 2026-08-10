import { useEffect, useMemo, useRef, useState } from 'react';
import { VideoView } from '@livekit/react-native';
import { Track } from 'livekit-client';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { SpeakBottomBar, SpeakMark } from '../../components/SpeakNavigation';
import { VoiceCallService, type VoiceCallState } from './VoiceCallService';

const BLUE = '#145CF6';
const WHITE = '#FFFFFF';

const LABELS: Record<Exclude<VoiceCallState['status'], 'idle'>, string> = {
  preparing: 'Calling…',
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
    const update = () => setDuration(Math.floor((Date.now() - (connectedAt.current ?? Date.now())) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [state.status]);

  const room = VoiceCallService.getRoom();
  const localVideoTrack = state.videoEnabled ? room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track : undefined;
  const remoteVideoTrack = useMemo(() => {
    if (!state.remoteVideoAvailable || !room) return undefined;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.videoTrackPublications.values()) {
        if (publication.track) return publication.track;
      }
    }
    return undefined;
  }, [room, state.remoteVideoAvailable]);

  if (state.status === 'idle') return null;
  const incoming = state.role === 'recipient' && state.status === 'ringing';
  const connected = ['connected', 'reconnecting'].includes(state.status);
  const videoVisible = Boolean(state.videoEnabled || state.remoteVideoAvailable);
  const initial = (state.remoteLabel || 'S').trim().slice(0, 1).toUpperCase();
  const placingCall = ['preparing', 'ringing', 'connecting'].includes(state.status);
  const outgoingLabel = placingCall && state.callMode === 'video' ? 'Video Calling…' : placingCall && state.callMode === 'interpreter' ? 'Interpreter Calling…' : LABELS[state.status];
  const callLabel = state.callMode === 'video' ? 'Speak Video Call' : state.callMode === 'interpreter' ? 'Speak Interpreter' : 'Speak Call';

  return <Modal animationType="fade" onRequestClose={() => void VoiceCallService.endCall()} visible>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><SpeakMark compact /><Text style={styles.contactName}>{state.remoteLabel || 'Speak contact'}</Text><Text style={styles.status}>{outgoingLabel}</Text><Text style={styles.timer}>{connectedAt.current ? formatDuration(duration) : callLabel}</Text></View>

      <View style={styles.stage}>
        {remoteVideoTrack ? <VideoView objectFit="cover" style={styles.remoteVideo} videoTrack={remoteVideoTrack as never} /> : <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>}
        {!videoVisible ? <Text style={styles.name}>{state.remoteLabel || 'Speak contact'}</Text> : null}
        {localVideoTrack ? <VideoView mirror objectFit="cover" style={styles.localVideo} videoTrack={localVideoTrack as never} /> : null}
      </View>

      {incoming ? <View style={styles.incomingActions}>
        <Pressable onPress={() => void VoiceCallService.declineIncomingCall()} style={[styles.roundAction, styles.decline]}><Text style={styles.actionText}>Decline</Text></Pressable>
        <Pressable onPress={() => void VoiceCallService.acceptIncomingCall()} style={[styles.roundAction, styles.answer]}><Text style={styles.actionText}>Answer</Text></Pressable>
      </View> : <>
        <Pressable disabled={!connected} onPress={() => void VoiceCallService.toggleInterpreter()} style={[styles.interpreter, state.interpreterEnabled && styles.interpreterActive, !connected && styles.disabled]}>
          <Text style={[styles.interpreterTitle, state.interpreterEnabled && styles.interpreterTitleActive]}>Speak Interpreter {state.interpreterEnabled ? 'On' : 'Off'}</Text>
          <Text style={[styles.interpreterHint, state.interpreterEnabled && styles.interpreterTitleActive]}>{state.interpreterEnabled ? 'Live translation is active' : 'Tap to translate this call'}</Text>
        </Pressable>
        <View style={styles.controls}>
          <Control active={state.muted} disabled={!connected} label={state.muted ? 'Unmute' : 'Mute'} onPress={() => void VoiceCallService.toggleMute()} />
          <Control active={state.speakerEnabled} disabled={!connected} label="Speaker" onPress={() => void VoiceCallService.toggleSpeaker()} />
          <Control active={state.videoEnabled} disabled={!connected} label={state.videoEnabled ? 'Video Off' : 'Video'} onPress={() => void (state.videoEnabled ? VoiceCallService.disableVideo() : VoiceCallService.enableVideo())} />
          {state.videoEnabled ? <Control label="Flip" onPress={() => void VoiceCallService.switchCamera()} /> : null}
        </View>
        <Pressable onPress={() => void VoiceCallService.endCall()} style={styles.end}><Text style={styles.endText}>End Call</Text></Pressable>
      </>}
      <SpeakBottomBar onHome={() => undefined} onSpeak={() => void VoiceCallService.toggleInterpreter()} onUtilities={() => void VoiceCallService.toggleSpeaker()} />
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
  remoteVideo: { height: '100%', width: '100%' },
  avatar: { alignItems: 'center', borderColor: '#19D7FF', borderRadius: 78, borderWidth: 2, height: 156, justifyContent: 'center', shadowColor: '#19D7FF', shadowOpacity: 0.62, shadowRadius: 22, width: 156 },
  avatarText: { color: '#4EAFFF', fontSize: 62, fontWeight: '600' },
  name: { color: '#F8FBFF', fontSize: 26, fontWeight: '700', marginTop: 22 },
  nameOnVideo: { backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 18, bottom: 18, left: 18, marginTop: 0, paddingHorizontal: 14, paddingVertical: 8, position: 'absolute' },
  localVideo: { borderColor: WHITE, borderRadius: 18, borderWidth: 2, height: 150, position: 'absolute', right: 15, top: 15, width: 108 },
  interpreter: { backgroundColor: 'rgba(7,23,51,0.72)', borderColor: '#187DFF', borderRadius: 24, borderWidth: 1, marginHorizontal: 24, paddingHorizontal: 18, paddingVertical: 13 },
  interpreterActive: { backgroundColor: '#075BFF', borderColor: '#19D7FF', shadowColor: '#19D7FF', shadowOpacity: 0.46, shadowRadius: 12 },
  interpreterTitle: { color: '#72B8FF', fontSize: 17, fontWeight: '700' },
  interpreterTitleActive: { color: WHITE },
  interpreterHint: { color: '#8BA6C9', fontSize: 12, marginTop: 2 },
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
