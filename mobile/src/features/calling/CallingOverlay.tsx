import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SpeakBottomBar, SpeakMark } from '../../components/SpeakNavigation';
import { ContactsPermissionPanel } from '../contacts/ContactsPermissionPanel';

const BLUE = '#145CF6';

export function CallingOverlay({ onClose, onOpenSpeakTools, onOpenUtilities, visible }: { onClose: () => void; onOpenSpeakTools: () => void; onOpenUtilities: () => void; visible: boolean }) {
  const insets = useSafeAreaInsets();
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_, gesture) => { if (gesture.dy > 80) onClose(); },
  });

  return <Modal animationType="fade" onRequestClose={onClose} visible={visible}>
    <View style={[styles.page, { paddingTop: insets.top + 8 }]} {...panResponder.panHandlers}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Close calling" accessibilityRole="button" hitSlop={14} onPress={onClose} style={styles.headerButton}><Text style={styles.close}>‹</Text></Pressable>
        <SpeakMark compact />
        <View style={styles.headerButton} />
      </View>
      <View style={styles.content}><ContactsPermissionPanel autoRequest onBack={onClose} /></View>
      <SpeakBottomBar onHome={onClose} onSpeak={onOpenSpeakTools} onUtilities={onOpenUtilities} />
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#FFFFFF', flex: 1, paddingHorizontal: 18 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 8 },
  headerButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  title: { color: '#102A56', fontSize: 31, fontWeight: '700' },
  subtitle: { color: '#5277B8', fontSize: 13, marginTop: 2 },
  close: { color: BLUE, fontSize: 34, fontWeight: '300' },
  content: { flex: 1 },
});
