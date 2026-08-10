import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Image, Modal, Pressable, SafeAreaView, Share, StyleSheet, Text, View } from 'react-native';

const BLUE = '#1463FF';
const WHITE = '#FFFFFF';

export function SpeakCameraModal({ onClose, visible }: { onClose: () => void; visible: boolean }) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  if (!visible) return null;

  const close = () => {
    setPhotoUri(null);
    onClose();
  };

  const capture = async () => {
    if (!camera.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.92, skipProcessing: false });
      if (photo?.uri) setPhotoUri(photo.uri);
    } finally {
      setCapturing(false);
    }
  };

  const save = async () => {
    if (!photoUri) return;
    const response = await MediaLibrary.requestPermissionsAsync(true);
    if (!response.granted) return;
    await MediaLibrary.createAssetAsync(photoUri);
  };

  const share = async () => {
    if (!photoUri) return;
    await Share.share({ message: 'Photo from Speak', url: photoUri });
  };

  return <Modal animationType="slide" onRequestClose={close} visible>
    <View style={styles.page}>
      {photoUri ? <Image resizeMode="contain" source={{ uri: photoUri }} style={StyleSheet.absoluteFill} /> : permission?.granted
        ? <CameraView facing={facing} flash={flash} ref={camera} style={StyleSheet.absoluteFill} />
        : <View style={styles.permission}>
          <Text style={styles.permissionTitle}>Speak Camera</Text>
          <Text style={styles.permissionBody}>Allow camera access to capture photos.</Text>
          <Pressable onPress={() => void requestPermission()} style={styles.primary}><Text style={styles.primaryText}>Enable Camera</Text></Pressable>
        </View>}

      <SafeAreaView style={styles.overlay}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Close camera" onPress={close} style={styles.glassButton}><Text style={styles.glassText}>Close</Text></Pressable>
          <Text style={styles.title}>{photoUri ? 'Preview' : 'Camera'}</Text>
          {photoUri ? <View style={styles.headerSpacer} /> : <Pressable accessibilityLabel="Toggle flash" disabled={!permission?.granted} onPress={() => setFlash((current) => current === 'off' ? 'on' : 'off')} style={styles.glassButton}><Text style={styles.glassText}>{flash === 'off' ? 'Flash' : 'Flash On'}</Text></Pressable>}
        </View>

        {photoUri ? <View style={styles.previewActions}>
          <Pressable onPress={() => setPhotoUri(null)} style={styles.secondary}><Text style={styles.secondaryText}>Retake</Text></Pressable>
          <Pressable onPress={() => void save()} style={styles.secondary}><Text style={styles.secondaryText}>Save</Text></Pressable>
          <Pressable onPress={() => void share()} style={styles.share}><Text style={styles.shareText}>Send</Text></Pressable>
        </View> : permission?.granted ? <View style={styles.cameraControls}>
          <View style={styles.controlSpacer} />
          <Pressable accessibilityLabel="Take photo" disabled={capturing} onPress={() => void capture()} style={[styles.shutterOuter, capturing && styles.disabled]}><View style={styles.shutterInner} /></Pressable>
          <Pressable accessibilityLabel="Flip camera" onPress={() => setFacing((current) => current === 'front' ? 'back' : 'front')} style={styles.flip}><Text style={styles.flipText}>Flip</Text></Pressable>
        </View> : <View />}
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#000000', flex: 1 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 8 },
  title: { color: WHITE, fontSize: 17, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 8 },
  headerSpacer: { width: 72 },
  glassButton: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.48)', borderColor: 'rgba(255,255,255,0.35)', borderRadius: 20, borderWidth: 1, minWidth: 72, paddingHorizontal: 12, paddingVertical: 10 },
  glassText: { color: WHITE, fontSize: 13, fontWeight: '700' },
  cameraControls: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.42)', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 24, paddingHorizontal: 34, paddingTop: 18 },
  controlSpacer: { width: 58 },
  shutterOuter: { alignItems: 'center', borderColor: WHITE, borderRadius: 39, borderWidth: 4, height: 78, justifyContent: 'center', width: 78 },
  shutterInner: { backgroundColor: WHITE, borderRadius: 31, height: 62, width: 62 },
  flip: { alignItems: 'center', backgroundColor: 'rgba(20,99,255,0.82)', borderRadius: 29, height: 58, justifyContent: 'center', width: 58 },
  flipText: { color: WHITE, fontSize: 13, fontWeight: '800' },
  previewActions: { backgroundColor: 'rgba(0,0,0,0.62)', flexDirection: 'row', gap: 10, paddingBottom: 24, paddingHorizontal: 18, paddingTop: 16 },
  secondary: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.35)', borderRadius: 22, borderWidth: 1, flex: 1, paddingVertical: 14 },
  secondaryText: { color: WHITE, fontSize: 14, fontWeight: '700' },
  share: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 22, flex: 1, paddingVertical: 14 },
  shareText: { color: WHITE, fontSize: 14, fontWeight: '800' },
  permission: { alignItems: 'center', backgroundColor: '#05070B', flex: 1, justifyContent: 'center', padding: 28 },
  permissionTitle: { color: WHITE, fontSize: 28, fontWeight: '800' },
  permissionBody: { color: '#B8C9E8', fontSize: 15, marginTop: 12, textAlign: 'center' },
  primary: { backgroundColor: BLUE, borderRadius: 24, marginTop: 24, paddingHorizontal: 24, paddingVertical: 15 },
  primaryText: { color: WHITE, fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
