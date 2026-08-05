import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { useAuth } from '../account/AuthProvider';

export type MenuDestination =
  | 'account'
  | 'membership'
  | 'billing'
  | 'settings'
  | 'languages'
  | 'notifications'
  | 'interpreter_calls'
  | 'help'
  | 'support';

type MenuItem = { destination: MenuDestination; icon: string; label: string };

const SECTIONS: Array<{ label: string; items: MenuItem[] }> = [
  {
    label: 'ACCOUNT',
    items: [
      { destination: 'account', icon: '◯', label: 'My Account' },
      { destination: 'membership', icon: '♕', label: 'Interpreter Pro' },
      { destination: 'billing', icon: '▤', label: 'Billing & Payments' },
    ],
  },
  {
    label: 'PREFERENCES',
    items: [
      { destination: 'settings', icon: '⚙', label: 'Settings' },
      { destination: 'languages', icon: '◎', label: 'Languages' },
      { destination: 'notifications', icon: '♧', label: 'Notifications' },
    ],
  },
  {
    label: 'SUPPORT & LEGAL',
    items: [
      { destination: 'interpreter_calls', icon: '☎', label: 'Interpreter Calls' },
      { destination: 'help', icon: '?', label: 'Help & FAQ' },
      { destination: 'support', icon: '⌁', label: 'Contact Support' },
    ],
  },
];

export function AppMenu({ onClose, onNavigate, visible }: {
  onClose: () => void;
  onNavigate: (destination: MenuDestination) => void;
  visible: boolean;
}) {
  const { isGuest, signOut, user } = useAuth();
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={48} style={styles.backdrop} tint="light">
      <Pressable accessibilityLabel="Close menu" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={styles.page}>
        <Pressable accessibilityLabel="Close menu" accessibilityRole="button" hitSlop={12} onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {SECTIONS.map((section) => (
            <View key={section.label} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              {section.items.filter((item) => !isGuest || !['membership', 'billing'].includes(item.destination)).map((item) => (
                <Pressable
                  key={item.destination}
                  accessibilityRole="button"
                  onPress={() => onNavigate(item.destination)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <Text style={styles.icon}>{item.icon}</Text>
                  <Text style={styles.label}>{item.label}</Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
            </View>
          ))}
          {user && !isGuest ? (
            <Pressable
              onPress={() => void signOut().then(onClose)}
              style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
            >
              <Text style={styles.logoutIcon}>↪</Text><Text style={styles.logoutText}>Log Out</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
      </BlurView>
    </Modal>
  );
}

const BLUE = '#075BFF';
const styles = StyleSheet.create({
  backdrop: { alignItems: 'flex-end', backgroundColor: 'rgba(9,28,64,0.14)', flex: 1, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 26 },
  page: { backgroundColor: 'rgba(248,251,255,0.68)', borderColor: 'rgba(255,255,255,0.94)', borderRadius: 32, borderWidth: 1, maxHeight: '94%', shadowColor: '#164995', shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.20, shadowRadius: 30, width: '92%' },
  close: { alignItems: 'center', elevation: 10, height: 54, justifyContent: 'center', position: 'absolute', right: 12, top: 10, width: 54, zIndex: 20 },
  closeText: { color: BLUE, fontSize: 42, fontWeight: '300', lineHeight: 45 },
  content: { paddingBottom: 30, paddingHorizontal: 28, paddingTop: 76 },
  section: { borderBottomColor: '#E5EAF2', borderBottomWidth: 1, marginBottom: 25, paddingBottom: 12 },
  sectionLabel: { color: '#667399', fontSize: 14, fontWeight: '700', marginBottom: 10 },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 58 },
  icon: { color: BLUE, fontSize: 25, textAlign: 'center', width: 44 },
  label: { color: '#101828', flex: 1, fontSize: 18, marginLeft: 8 },
  chevron: { color: '#65718A', fontSize: 34, fontWeight: '300' },
  logout: { alignItems: 'center', flexDirection: 'row', minHeight: 58 },
  logoutIcon: { color: '#FF315D', fontSize: 27, textAlign: 'center', width: 44 },
  logoutText: { color: '#FF315D', fontSize: 18, marginLeft: 8 },
  pressed: { opacity: 0.6 },
});
