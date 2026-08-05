import { useEffect, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { ContactsPermissionPanel } from '../contacts/ContactsPermissionPanel';
import { VoiceCallService } from './VoiceCallService';

type CallingView = 'actions' | 'contacts';

const BLUE = '#075BFF';
const ACTIONS = [
  { icon: 'phone', label: 'Voice Call', type: 'voice' },
  { icon: 'video', label: 'Video Call', type: 'video' },
] as const;

type CallingIconName = typeof ACTIONS[number]['icon'] | 'contacts';

function CallingIcon({ name }: { name: CallingIconName }) {
  if (name === 'phone') return <Svg height={25} viewBox="0 0 24 24" width={25}><Path d="M6.7 3.1 9 2.5c.7-.2 1.4.2 1.7.9l1 2.8c.2.6 0 1.2-.5 1.6L9.7 9a14.5 14.5 0 0 0 5.3 5.3l1.2-1.5c.4-.5 1-.7 1.6-.5l2.8 1c.7.3 1.1 1 1 1.7l-.6 2.3a3 3 0 0 1-3 2.3A15.4 15.4 0 0 1 4.4 6a3 3 0 0 1 2.3-2.9Z" fill="none" stroke={BLUE} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  if (name === 'video') return <Svg height={25} viewBox="0 0 24 24" width={25}><Rect fill="none" height={13} rx={3} stroke={BLUE} strokeWidth={1.8} width={13} x={2.5} y={5.5} /><Path d="m15.5 9 4-2.2c.8-.4 1.7.1 1.7 1v8.4c0 .9-.9 1.4-1.7 1l-4-2.2V9Z" fill="none" stroke={BLUE} strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  return <Svg height={25} viewBox="0 0 24 24" width={25}><Circle cx={12} cy={7.5} fill="none" r={4} stroke={BLUE} strokeWidth={1.8} /><Path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke={BLUE} strokeLinecap="round" strokeWidth={1.8} /></Svg>;
}

export function CallingOverlay({ languageOne, languageTwo, onClose, visible }: {
  languageOne: string;
  languageTwo: string;
  onClose: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<CallingView>('actions');
  const [autoRequestContacts, setAutoRequestContacts] = useState(false);
  const close = () => {
    setView('actions');
    setAutoRequestContacts(false);
    onClose();
  };
  useEffect(() => {
    if (!visible) setView('actions');
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    return VoiceCallService.subscribe((state) => {
      if (state.status !== 'preparing') return;
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
          <View accessibilityViewIsModal {...panResponder.panHandlers} style={[styles.sheet, { paddingTop: insets.top + 58 }]}>
            <Pressable accessibilityLabel="Close calling" accessibilityRole="button" hitSlop={12} onPress={close} style={[styles.close, { top: insets.top + 6 }]}><Text style={styles.closeText}>×</Text></Pressable>
            {view === 'contacts' ? <ContactsPermissionPanel autoRequest={autoRequestContacts} languageOne={languageOne} languageTwo={languageTwo} onBack={close} /> : (
              <View style={styles.content}>
                <Text style={styles.eyebrow}>INTERPRETER CALLING</Text>
                <Text style={styles.title}>Speak any language</Text>
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
                  <Text style={styles.ctaText}>Speak Now</Text>
                </Pressable>
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
  close: { alignItems: 'center', elevation: 10, height: 44, justifyContent: 'center', position: 'absolute', right: 16, width: 44, zIndex: 20 },
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
  cta: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 30, justifyContent: 'center', marginTop: 26, minHeight: 58 },
  ctaText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
});
