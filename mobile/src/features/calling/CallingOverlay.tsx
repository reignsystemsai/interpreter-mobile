import { useEffect, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { ContactsPermissionPanel } from '../contacts/ContactsPermissionPanel';
import { useCalling } from './CallProvider';
import { CallHistoryPanel } from './CallHistoryPanel';

type CallingView = 'actions' | 'contacts' | 'history';

const ACTIONS = [
  { icon: '☎', label: 'Voice Call', type: 'voice' },
  { icon: '▣', label: 'Video Call', type: 'video' },
  { icon: '▦', label: 'Business Video Call', type: 'business_video' },
] as const;

export function CallingOverlay({ onClose, visible }: {
  onClose: () => void;
  visible: boolean;
}) {
  const { enableIncomingNotifications } = useCalling();
  const [view, setView] = useState<CallingView>('actions');
  const close = () => { setView('actions'); onClose(); };
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_, gesture) => { if (gesture.dy > 80) close(); },
  });

  useEffect(() => {
    if (visible) void enableIncomingNotifications().catch(() => undefined);
  }, [enableIncomingNotifications, visible]);

  const openCall = (type: typeof ACTIONS[number]['type']) => {
    setView('contacts');
  };

  return (
    <Modal animationType="fade" onRequestClose={close} transparent visible={visible}>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={42} style={styles.backdrop} tint="light">
        <Pressable accessibilityLabel="Close calling" onPress={close} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal {...panResponder.panHandlers} style={styles.sheet}>
          <View style={styles.handle} />
          <Pressable accessibilityLabel="Close calling" accessibilityRole="button" onPress={close} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
          {view === 'contacts' ? <ContactsPermissionPanel onBack={close} /> : view === 'history' ? <CallHistoryPanel onBack={close} onRequireSignIn={close} /> : (
            <View>
              <Text style={styles.eyebrow}>INTERPRETER CALLING</Text>
              <Text style={styles.title}>Connect in any language</Text>
              <Text style={styles.subtitle}>Choose a contact, then start a secure voice or video call.</Text>
              <View style={styles.actions}>
                {ACTIONS.map((action) => (
                  <Pressable key={action.label} accessibilityRole="button" onPress={() => openCall(action.type)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                    <View style={styles.iconCircle}><Text style={styles.icon}>{action.icon}</Text></View>
                    <Text style={styles.actionLabel}>{action.label}</Text>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                ))}
                <Pressable accessibilityRole="button" onPress={() => setView('contacts')} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                  <View style={styles.iconCircle}><Text style={styles.icon}>♙</Text></View>
                  <Text style={styles.actionLabel}>My Contacts</Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setView('history')} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                  <View style={styles.iconCircle}><Text style={styles.icon}>↺</Text></View>
                  <Text style={styles.actionLabel}>Call History</Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              </View>
              <Text style={styles.signInNote}>3 free Interpreter Minutes every 30 days. No account required.</Text>
            </View>
          )}
        </View>
      </BlurView>
    </Modal>
  );
}

const BLUE = '#075BFF';
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: 'rgba(244,248,255,0.68)', borderColor: 'rgba(255,255,255,0.85)', borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, height: '88%', paddingBottom: 24, paddingHorizontal: 22, paddingTop: 14, shadowColor: '#164995', shadowOffset: { height: -8, width: 0 }, shadowOpacity: 0.16, shadowRadius: 24 },
  handle: { alignSelf: 'center', backgroundColor: '#B7C5DA', borderRadius: 3, height: 5, marginBottom: 20, width: 46 },
  close: { alignItems: 'center', height: 42, justifyContent: 'center', position: 'absolute', right: 16, top: 16, width: 42, zIndex: 2 },
  closeText: { color: BLUE, fontSize: 34, fontWeight: '300' },
  eyebrow: { color: BLUE, fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: '#101828', fontSize: 28, fontWeight: '800', marginTop: 5 },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: '88%' },
  actions: { gap: 10, marginTop: 22 },
  action: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.78)', borderColor: 'rgba(132,160,210,0.2)', borderRadius: 20, borderWidth: 1, flexDirection: 'row', minHeight: 66, paddingHorizontal: 14 },
  iconCircle: { alignItems: 'center', backgroundColor: '#EAF1FF', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  icon: { color: BLUE, fontSize: 21, fontWeight: '700' },
  actionLabel: { color: '#101828', flex: 1, fontSize: 17, fontWeight: '600', marginLeft: 14 },
  chevron: { color: '#7181A0', fontSize: 30, fontWeight: '300' },
  pressed: { opacity: 0.66 },
  disabled: { opacity: 0.45 },
  signInNote: { color: '#667085', fontSize: 12, marginTop: 14, textAlign: 'center' },
});
