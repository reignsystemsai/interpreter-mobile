import { useEffect, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { ContactsPermissionPanel } from '../contacts/ContactsPermissionPanel';
import { VoiceCallTestPanel } from './VoiceCallTestPanel';
import { CallService } from './CallService';

type CallingView = 'actions' | 'contacts' | 'voice_test';

const BLUE = '#075BFF';
const ACTIONS = [
  { icon: 'phone', label: 'Voice Call', type: 'voice' },
  { icon: 'video', label: 'Video Call', type: 'video' },
  { icon: 'briefcase', label: 'Business Video Call', type: 'business_video' },
] as const;

type CallingIconName = typeof ACTIONS[number]['icon'] | 'contacts';

function CallingIcon({ name }: { name: CallingIconName }) {
  if (name === 'phone') return <Svg height={25} viewBox="0 0 24 24" width={25}><Path d="M6.5 2.8 9 2.2c.7-.2 1.4.2 1.7.9l1.1 3.1c.2.6 0 1.2-.5 1.6L9.6 9.1a15.2 15.2 0 0 0 5.3 5.3l1.3-1.7c.4-.5 1-.7 1.6-.5l3.1 1.1c.7.3 1.1 1 1 1.7l-.7 2.5a3.2 3.2 0 0 1-3.2 2.4A15.9 15.9 0 0 1 4.1 6a3.2 3.2 0 0 1 2.4-3.2Z" fill={BLUE} /></Svg>;
  if (name === 'video') return <Svg height={25} viewBox="0 0 24 24" width={25}><Rect fill={BLUE} height={14} rx={3} width={14} x={2} y={5} /><Path d="m16 9 4.2-2.4c.8-.5 1.8.1 1.8 1v8.8c0 .9-1 1.5-1.8 1L16 15V9Z" fill={BLUE} /></Svg>;
  if (name === 'briefcase') return <Svg height={25} viewBox="0 0 24 24" width={25}><Path d="M9 4.5A2.5 2.5 0 0 1 11.5 2h1A2.5 2.5 0 0 1 15 4.5V6h4a3 3 0 0 1 3 3v2.1c-2.8 1.2-6.3 1.9-10 1.9s-7.2-.7-10-1.9V9a3 3 0 0 1 3-3h4V4.5Zm2 0V6h2V4.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5ZM2 13.2c2.9 1.1 6.3 1.8 10 1.8s7.1-.7 10-1.8V19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-5.8Z" fill={BLUE} /></Svg>;
  return <Svg height={25} viewBox="0 0 24 24" width={25}><Circle cx={12} cy={7.5} fill={BLUE} r={4.5} /><Path d="M3 21a9 9 0 0 1 18 0H3Z" fill={BLUE} /></Svg>;
}

export function CallingOverlay({ onClose, visible }: {
  onClose: () => void;
  visible: boolean;
}) {
  const [view, setView] = useState<CallingView>('actions');
  const [autoRequestContacts, setAutoRequestContacts] = useState(false);
  const close = () => {
    setView('actions');
    setAutoRequestContacts(false);
    void CallService.endCall();
    onClose();
  };
  useEffect(() => {
    if (visible) void CallService.resetStaleCallState();
    else setView('actions');
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    return CallService.subscribe((state) => {
      if (state.status !== 'connecting') return;
      setView('actions');
      onClose();
    });
  }, [onClose, visible]);
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_, gesture) => { if (gesture.dy > 80) close(); },
  });

  const openCall = (type: typeof ACTIONS[number]['type']) => {
    setAutoRequestContacts(type === 'voice');
    setView('contacts');
  };

  return (
    <Modal animationType="slide" onRequestClose={close} transparent visible={visible}>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={18} style={styles.backdrop} tint="light">
          <Pressable accessibilityLabel="Close calling" onPress={close} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal {...panResponder.panHandlers} style={styles.sheet}>
            <Pressable accessibilityLabel="Close calling" accessibilityRole="button" onPress={close} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
            {view === 'contacts' ? <ContactsPermissionPanel autoRequest={autoRequestContacts} onBack={close} /> : view === 'voice_test' ? <VoiceCallTestPanel onBack={() => setView('actions')} /> : (
              <View style={styles.content}>
                <Text style={styles.eyebrow}>INTERPRETER CALLING</Text>
                <Text style={styles.title}>Connect in any language</Text>
                <Text style={styles.subtitle}>Choose a contact, then start a secure voice or video call.</Text>
                <View style={styles.actions}>
                  {ACTIONS.map((action) => (
                    <Pressable key={action.label} accessibilityRole="button" onPress={() => openCall(action.type)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                      <View style={styles.iconCircle}><CallingIcon name={action.icon} /></View>
                      <Text style={styles.actionLabel}>{action.label}</Text>
                      <Text style={styles.chevron}>›</Text>
                    </Pressable>
                  ))}
                  <Pressable accessibilityRole="button" onPress={() => { setAutoRequestContacts(false); setView('contacts'); }} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                    <View style={styles.iconCircle}><CallingIcon name="contacts" /></View>
                    <Text style={styles.actionLabel}>My Contacts</Text>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                </View>
                <View style={styles.footerCopy}>
                  <Text style={styles.allowance}>3 free Interpreter Minutes every 30 days.</Text>
                  <Text style={styles.noAccount}>No account required.</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => { setAutoRequestContacts(true); setView('contacts'); }} style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
                  <Text style={styles.ctaText}>Get Started</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setView('voice_test')} style={styles.testFallback}><Text style={styles.testFallbackText}>Use temporary call code</Text></Pressable>
              </View>
            )}
          </View>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { backgroundColor: 'rgba(255,255,255,0.12)', flex: 1, paddingBottom: 28, paddingHorizontal: 22, paddingTop: 68 },
  content: { flex: 1 },
  close: { alignItems: 'center', height: 44, justifyContent: 'center', position: 'absolute', right: 16, top: 20, width: 44, zIndex: 2 },
  closeText: { color: BLUE, fontSize: 34, fontWeight: '300' },
  eyebrow: { color: BLUE, fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: '#101828', fontSize: 28, fontWeight: '800', marginTop: 5 },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: '88%' },
  actions: { gap: 14, marginTop: 25 },
  action: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.26)', borderRadius: 32, flexDirection: 'row', minHeight: 62, paddingHorizontal: 13 },
  iconCircle: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.28)', borderRadius: 21, height: 42, justifyContent: 'center', width: 42 },
  actionLabel: { color: '#101828', flex: 1, fontSize: 17, fontWeight: '600', marginLeft: 14 },
  chevron: { color: BLUE, fontSize: 29, fontWeight: '400', marginRight: 4 },
  pressed: { opacity: 0.58 },
  footerCopy: { alignItems: 'center', marginTop: 18 },
  allowance: { color: '#667085', fontSize: 12, textAlign: 'center' },
  noAccount: { color: BLUE, fontSize: 12, fontWeight: '600', marginTop: 3, textAlign: 'center' },
  cta: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 30, justifyContent: 'center', marginTop: 'auto', minHeight: 58 },
  ctaText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  testFallback: { alignItems: 'center', paddingVertical: 12 }, testFallbackText: { color: BLUE, fontSize: 13, fontWeight: '600' },
});
