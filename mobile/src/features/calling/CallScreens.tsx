import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { RoomContext, useTracks, VideoTrack } from '@livekit/react-native';
import { Track } from 'livekit-client';

import { useCalling } from './CallProvider';
import { useInterpretedCall } from '../../hooks/useInterpretedCall';
import { friendlyCallMessage, terminalCallMessage } from './callMessages';

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function callLabel(type: 'voice' | 'video' | 'business_video') {
  if (type === 'voice') return 'Voice Call';
  if (type === 'business_video') return 'Business Video Call';
  return 'Video Call';
}

function VideoCanvas() {
  const tracks = useTracks([Track.Source.Camera]);
  const remote = tracks.find((item) => !item.participant.isLocal);
  const local = tracks.find((item) => item.participant.isLocal);
  return (
    <View style={styles.videoCanvas}>
      {remote ? <VideoTrack objectFit="cover" style={styles.remoteVideo} trackRef={remote} /> : <View style={styles.videoWaiting}><Text style={styles.videoWaitingText}>Waiting for video…</Text></View>}
      {local ? <VideoTrack mirror objectFit="cover" style={styles.localVideo} trackRef={local} zOrder={1} /> : null}
    </View>
  );
}

export function CallSurfaces() {
  const calling = useCalling();
  const { currentCall, incomingCall, room } = calling;
  const interpreted = useInterpretedCall({ call: currentCall, connectionStatus: calling.connectionStatus, room });
  const latestTurn = interpreted.turns[interpreted.turns.length - 1];
  const [showConnected, setShowConnected] = useState(false);
  useEffect(() => {
    if (calling.connectionStatus !== 'connected') { setShowConnected(false); return; }
    setShowConnected(true);
    const timer = setTimeout(() => setShowConnected(false), 1_500);
    return () => clearTimeout(timer);
  }, [calling.connectionStatus, currentCall?.id]);
  const terminalMessage = terminalCallMessage(currentCall?.status);
  const connectionMessage = terminalMessage || calling.callMessage || (
    currentCall?.status === 'ringing' ? 'Ringing...' :
      calling.connectionStatus === 'connecting' ? 'Connecting...' :
        calling.connectionStatus === 'reconnecting' ? 'Reconnecting...' :
          calling.connectionStatus === 'disconnected' ? 'Connection Lost' :
            calling.connectionStatus === 'failed' ? 'Call Failed' :
              showConnected ? 'Connected' : null
  );
  return (
    <>
      <Modal animationType="fade" onRequestClose={() => void calling.declineIncoming()} transparent visible={Boolean(incomingCall && !currentCall)}>
        <BlurView experimentalBlurMethod="dimezisBlurView" intensity={65} style={styles.incomingBackdrop} tint="dark">
          <SafeAreaView style={styles.incomingContent}>
            <Text style={styles.kicker}>INCOMING {incomingCall ? callLabel(incomingCall.callType).toUpperCase() : 'CALL'}</Text>
            <View style={styles.avatar}><Text style={styles.avatarText}>{incomingCall?.otherParty.displayName.slice(0, 1).toUpperCase()}</Text></View>
            <Text style={styles.person}>{incomingCall?.otherParty.displayName}</Text>
            <Text style={styles.status}>Ringing...</Text>
            <View style={styles.incomingActions}>
              <CallButton color="#D92D20" icon="×" label="Decline" onPress={() => void calling.declineIncoming().catch((error) => Alert.alert('Unable to decline', friendlyCallMessage(error)))} />
              <CallButton color="#12B76A" icon="✓" label="Accept" onPress={() => void calling.acceptIncoming().catch((error) => Alert.alert('Unable to connect', friendlyCallMessage(error)))} />
            </View>
          </SafeAreaView>
        </BlurView>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => void calling.endCall()} visible={Boolean(currentCall)}>
        <SafeAreaView style={styles.callScreen}>
          {room && currentCall?.callType !== 'voice' ? <RoomContext.Provider value={room}><VideoCanvas /></RoomContext.Provider> : null}
          <View style={[styles.callContent, room && currentCall?.callType !== 'voice' && styles.callContentOverVideo]}>
            <Text style={styles.kicker}>{currentCall ? callLabel(currentCall.callType).toUpperCase() : ''}</Text>
            {currentCall?.callType === 'voice' ? <View style={styles.avatar}><Text style={styles.avatarText}>{currentCall.otherParty.displayName.slice(0, 1).toUpperCase()}</Text></View> : null}
            <Text style={styles.person}>{currentCall?.otherParty.displayName}</Text>
            {connectionMessage ? (
              <Pressable disabled={calling.connectionStatus !== 'failed'} onPress={() => void calling.retryCall().catch(() => undefined)}>
                <Text accessibilityLiveRegion="polite" style={styles.status}>{connectionMessage}</Text>
              </Pressable>
            ) : <View style={styles.statusSpacer} />}
            {currentCall?.answeredAt ? <Text style={styles.duration}>{formatDuration(calling.durationSeconds)}</Text> : null}
            {currentCall && ['accepted', 'active'].includes(currentCall.status) ? (
              <View accessibilityLiveRegion="polite" style={styles.interpretationPanel}>
                <Text style={styles.interpretationStatus}>
                  {interpreted.state === 'active' ? 'Live interpretation' : interpreted.state === 'reconnecting' ? 'Interpretation reconnecting...' : interpreted.state === 'unavailable' ? 'Direct audio' : 'Starting interpretation...'}
                  {interpreted.averageLatencyMs !== null ? `  |  ${interpreted.averageLatencyMs} ms` : ''}
                </Text>
                {latestTurn?.original ? <Text numberOfLines={2} style={styles.originalText}><Text style={styles.languageLabel}>{latestTurn.sourceLanguage}: </Text>{latestTurn.original}</Text> : null}
                {latestTurn?.translation ? <Text numberOfLines={2} style={styles.translationText}><Text style={styles.languageLabel}>{latestTurn.targetLanguage}: </Text>{latestTurn.translation}</Text> : null}
                {interpreted.error ? <Pressable onPress={() => void interpreted.retry()}><Text style={styles.retryText}>{interpreted.error} Tap to retry.</Text></Pressable> : null}
              </View>
            ) : null}
            <View style={styles.controls}>
              <CallButton color={calling.muted ? '#075BFF' : '#344054'} icon={calling.muted ? 'M' : 'μ'} label={calling.muted ? 'Unmute' : 'Mute'} onPress={() => void calling.toggleMute().catch(() => undefined)} />
              <CallButton color={calling.speakerEnabled ? '#075BFF' : '#344054'} icon="S" label="Speaker" onPress={() => void calling.toggleSpeaker().catch(() => undefined)} />
              {currentCall?.callType !== 'voice' ? <CallButton color={calling.cameraEnabled ? '#075BFF' : '#344054'} icon="V" label={calling.cameraEnabled ? 'Camera' : 'Camera off'} onPress={() => void calling.toggleCamera().catch(() => undefined)} /> : null}
              {currentCall?.callType !== 'voice' ? <CallButton color="#344054" icon="↻" label="Flip" onPress={() => void calling.switchCamera().catch(() => undefined)} /> : null}
            </View>
            <CallButton color="#D92D20" icon="×" label="End Call" onPress={() => void calling.endCall()} />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function CallButton({ color, icon, label, onPress }: { color: string; icon: string; label: string; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.controlWrap}><View style={[styles.control, { backgroundColor: color }]}><Text style={styles.controlIcon}>{icon}</Text></View><Text style={styles.controlLabel}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  incomingBackdrop: { backgroundColor: 'rgba(8,17,35,0.78)', flex: 1 }, incomingContent: { alignItems: 'center', flex: 1, justifyContent: 'space-around', paddingHorizontal: 30, paddingVertical: 70 }, callScreen: { backgroundColor: '#081123', flex: 1 }, callContent: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 38 }, callContentOverVideo: { backgroundColor: 'rgba(3,10,24,0.34)', bottom: 0, justifyContent: 'flex-end', left: 0, position: 'absolute', right: 0, top: 0 }, kicker: { color: '#9CB9F9', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 }, avatar: { alignItems: 'center', backgroundColor: '#EAF1FF', borderRadius: 62, height: 124, justifyContent: 'center', marginTop: 35, width: 124 }, avatarText: { color: '#075BFF', fontSize: 52, fontWeight: '800' }, person: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', marginTop: 20, textAlign: 'center' }, status: { color: '#D0D5DD', fontSize: 16, marginTop: 8, textAlign: 'center' }, statusSpacer: { height: 27 }, duration: { color: '#98A2B3', fontSize: 13, marginBottom: 22, marginTop: 5 }, incomingActions: { flexDirection: 'row', justifyContent: 'space-around', width: '100%' }, controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, justifyContent: 'center', marginBottom: 24, maxWidth: 360 }, controlWrap: { alignItems: 'center', minWidth: 66 }, control: { alignItems: 'center', borderRadius: 31, height: 62, justifyContent: 'center', width: 62 }, controlIcon: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' }, controlLabel: { color: '#FFFFFF', fontSize: 11, fontWeight: '600', marginTop: 7 }, videoCanvas: { ...StyleSheet.absoluteFillObject, backgroundColor: '#101828' }, remoteVideo: { height: '100%', width: '100%' }, localVideo: { borderColor: '#FFFFFF', borderRadius: 14, borderWidth: 2, height: 170, position: 'absolute', right: 16, top: 20, width: 108 }, videoWaiting: { alignItems: 'center', flex: 1, justifyContent: 'center' }, videoWaitingText: { color: '#D0D5DD', fontSize: 15 },
  interpretationPanel: { backgroundColor: 'rgba(8,17,35,0.78)', borderColor: 'rgba(156,185,249,0.34)', borderRadius: 16, borderWidth: 1, marginBottom: 22, maxWidth: 420, paddingHorizontal: 14, paddingVertical: 11, width: '100%' }, interpretationStatus: { color: '#9CB9F9', fontSize: 11, fontWeight: '800', marginBottom: 7, textTransform: 'uppercase' }, languageLabel: { color: '#9CB9F9', fontWeight: '800' }, originalText: { color: '#E4E7EC', fontSize: 13, lineHeight: 18 }, translationText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', lineHeight: 20, marginTop: 5 }, retryText: { color: '#FDA29B', fontSize: 12, marginTop: 7 },
});
