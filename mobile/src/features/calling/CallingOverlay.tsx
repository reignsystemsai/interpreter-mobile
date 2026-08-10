import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContactsPermissionPanel } from '../contacts/ContactsPermissionPanel';

const BLUE = '#145CF6';

export function CallingOverlay({ onClose, visible }: { onClose: () => void; visible: boolean }) {
  const insets = useSafeAreaInsets();
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_, gesture) => { if (gesture.dy > 80) onClose(); },
  });

  return <Modal animationType="fade" onRequestClose={onClose} visible={visible}>
    <View style={[styles.page, { paddingTop: insets.top + 8 }]} {...panResponder.panHandlers}>
      <View style={styles.header}>
        <View><Text style={styles.title}>Call</Text><Text style={styles.subtitle}>Choose a contact or dial a number.</Text></View>
        <Pressable accessibilityLabel="Close calling" accessibilityRole="button" hitSlop={14} onPress={onClose}><Text style={styles.close}>×</Text></Pressable>
      </View>
      <View style={styles.content}><ContactsPermissionPanel autoRequest onBack={onClose} /></View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#03060D', flex: 1, paddingHorizontal: 22 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 18 },
  title: { color: '#FFFFFF', fontSize: 31, fontWeight: '700' },
  subtitle: { color: '#75A9FF', fontSize: 13, marginTop: 2 },
  close: { color: BLUE, fontSize: 38, fontWeight: '300' },
  content: { flex: 1 },
});
