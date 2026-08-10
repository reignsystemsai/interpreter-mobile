import { useState } from 'react';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

const BLUE = '#1463FF';
const WHITE = '#FFFFFF';

export function CameraInterpreterModal({
  languageOne,
  languageTwo,
  onClose,
  visible,
}: {
  languageOne: string;
  languageTwo: string;
  onClose: () => void;
  visible: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');

  if (!visible) return null;

  return <Modal animationType="slide" onRequestClose={onClose} visible>
    <View style={styles.page}>
      {permission?.granted ? <CameraView facing={facing} style={StyleSheet.absoluteFill} /> : <View style={styles.permission}>
        <Text style={styles.permissionTitle}>Camera Interpreter</Text>
        <Text style={styles.permissionBody}>Camera access lets Speak keep the conversation visible while you interpret in person.</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.primary}><Text style={styles.primaryText}>Enable Camera</Text></Pressable>
      </View>}

      <SafeAreaView style={styles.overlay}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Close camera" onPress={onClose} style={styles.glassButton}><Text style={styles.glassText}>Close</Text></Pressable>
          <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>Camera Interpreter</Text></View>
          <Pressable accessibilityLabel="Flip camera" disabled={!permission?.granted} onPress={() => setFacing((current) => current === 'front' ? 'back' : 'front')} style={styles.glassButton}><Text style={styles.glassText}>Flip</Text></Pressable>
        </View>
        <View style={styles.footer}>
          <View style={styles.languagePill}><Text style={styles.language}>{languageOne}</Text><Text style={styles.swap}>⇄</Text><Text style={styles.language}>{languageTwo}</Text></View>
          <Text style={styles.hint}>Speak naturally. Translation follows your selected languages.</Text>
        </View>
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#000000', flex: 1 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 8 },
  glassButton: { backgroundColor: 'rgba(0,0,0,0.46)', borderColor: 'rgba(255,255,255,0.35)', borderRadius: 20, borderWidth: 1, minWidth: 66, paddingHorizontal: 13, paddingVertical: 10 },
  glassText: { color: WHITE, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  livePill: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.52)', borderRadius: 22, flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10 },
  liveDot: { backgroundColor: BLUE, borderRadius: 5, height: 10, marginRight: 8, width: 10 },
  liveText: { color: WHITE, fontSize: 14, fontWeight: '700' },
  footer: { alignItems: 'center', paddingBottom: 24, paddingHorizontal: 20 },
  languagePill: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.62)', borderColor: 'rgba(255,255,255,0.3)', borderRadius: 26, borderWidth: 1, flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 14 },
  language: { color: WHITE, fontSize: 15, fontWeight: '700' },
  swap: { color: '#73ADFF', fontSize: 22, marginHorizontal: 14 },
  hint: { color: WHITE, fontSize: 12, marginTop: 10, opacity: 0.82, textAlign: 'center' },
  permission: { alignItems: 'center', backgroundColor: '#05070B', flex: 1, justifyContent: 'center', padding: 28 },
  permissionTitle: { color: WHITE, fontSize: 28, fontWeight: '800' },
  permissionBody: { color: '#B8C9E8', fontSize: 15, lineHeight: 22, marginTop: 12, textAlign: 'center' },
  primary: { backgroundColor: BLUE, borderRadius: 24, marginTop: 24, paddingHorizontal: 24, paddingVertical: 15 },
  primaryText: { color: WHITE, fontSize: 16, fontWeight: '800' },
});
