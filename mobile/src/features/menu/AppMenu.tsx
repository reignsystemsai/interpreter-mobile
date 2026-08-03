import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../account/AuthProvider';

export type MenuDestination =
  | 'account'
  | 'membership'
  | 'billing'
  | 'settings'
  | 'languages'
  | 'notifications'
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
  const { signOut, user } = useAuth();
  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      <View style={styles.page}>
        <Pressable accessibilityLabel="Close menu" onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {SECTIONS.map((section) => (
            <View key={section.label} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              {section.items.map((item) => (
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
          <View style={styles.legalNotice}>
            <Text style={styles.legalTitle}>Legal review in progress</Text>
            <Text style={styles.legalBody}>Privacy Policy and Terms of Service will appear here after final legal approval.</Text>
          </View>
          {user ? (
            <Pressable
              onPress={() => void signOut().then(onClose)}
              style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
            >
              <Text style={styles.logoutIcon}>↪</Text><Text style={styles.logoutText}>Log Out</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const BLUE = '#075BFF';
const styles = StyleSheet.create({
  page: { backgroundColor: '#FFFFFF', flex: 1 },
  close: { alignItems: 'center', height: 54, justifyContent: 'center', position: 'absolute', right: 18, top: 42, width: 54, zIndex: 2 },
  closeText: { color: BLUE, fontSize: 42, fontWeight: '300', lineHeight: 45 },
  content: { paddingBottom: 38, paddingHorizontal: 34, paddingTop: 120 },
  section: { borderBottomColor: '#E5EAF2', borderBottomWidth: 1, marginBottom: 25, paddingBottom: 12 },
  sectionLabel: { color: '#667399', fontSize: 14, fontWeight: '700', marginBottom: 10 },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 58 },
  icon: { color: BLUE, fontSize: 25, textAlign: 'center', width: 44 },
  label: { color: '#101828', flex: 1, fontSize: 18, marginLeft: 8 },
  chevron: { color: '#65718A', fontSize: 34, fontWeight: '300' },
  legalNotice: { backgroundColor: '#F4F7FC', borderRadius: 14, marginBottom: 18, padding: 14 },
  legalTitle: { color: '#344054', fontSize: 14, fontWeight: '700' },
  legalBody: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 4 },
  logout: { alignItems: 'center', flexDirection: 'row', minHeight: 58 },
  logoutIcon: { color: '#FF315D', fontSize: 27, textAlign: 'center', width: 44 },
  logoutText: { color: '#FF315D', fontSize: 18, marginLeft: 8 },
  pressed: { opacity: 0.6 },
});
