import { useEffect, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
import * as Notifications from 'expo-notifications';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  dismissPhoneNumberPrompt,
  normalizeE164,
  registerDeviceInstallation,
  restoreAndRefreshDeviceRegistration,
  wasPhoneNumberPrompted,
} from '../../services/deviceRegistration';
import { CallService } from './CallService';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function incomingCode(notification: Notifications.Notification | undefined) {
  const data = notification?.request.content.data;
  return data?.type === 'incoming_voice_call' && typeof data.temporaryCallCode === 'string'
    ? data.temporaryCallCode
    : '';
}

export function DeviceRegistrationPrompt() {
  const [visible, setVisible] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const handledCodes = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    void restoreAndRefreshDeviceRegistration().catch(() => false).then(async (restored) => {
      if (!active || restored) return;
      if (!(await wasPhoneNumberPrompted()) && active) setVisible(true);
    });
    const answer = (notification: Notifications.Notification | undefined) => {
      const code = incomingCode(notification);
      if (!code || handledCodes.current.has(code)) return;
      handledCodes.current.add(code);
      void CallService.joinVoiceCall(code).catch(() => handledCodes.current.delete(code));
    };
    const listener = Notifications.addNotificationResponseReceivedListener((response) => answer(response.notification));
    void Notifications.getLastNotificationResponseAsync().then((response) => answer(response?.notification));
    return () => { active = false; listener.remove(); };
  }, []);

  const save = async () => {
    if (!normalizeE164(phoneNumber)) {
      setError('Enter a valid phone number including area code.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await registerDeviceInstallation(phoneNumber);
      setVisible(false);
    } catch {
      setVisible(false);
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    await dismissPhoneNumberPrompt();
    setVisible(false);
  };

  return (
    <Modal animationType="fade" onRequestClose={() => void skip()} transparent visible={visible}>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={55} style={styles.backdrop} tint="light">
        <View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>Your phone number</Text>
          <Text style={styles.body}>Enter it once so other Interpreter users can call this device.</Text>
          <TextInput autoComplete="tel" keyboardType="phone-pad" onChangeText={setPhoneNumber} placeholder="(305) 555-1234" style={styles.input} value={phoneNumber} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={saving} onPress={() => void save()} style={styles.primary}><Text style={styles.primaryText}>{saving ? 'Saving...' : 'Continue'}</Text></Pressable>
          <Pressable onPress={() => void skip()} style={styles.secondary}><Text style={styles.secondaryText}>Not Now</Text></Pressable>
        </View>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(8,18,38,0.16)', flex: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: 'rgba(248,251,255,0.76)', borderRadius: 28, maxWidth: 420, padding: 24, width: '100%' },
  title: { color: '#101828', fontSize: 23, fontWeight: '800', textAlign: 'center' },
  body: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  input: { backgroundColor: 'rgba(255,255,255,0.84)', borderRadius: 17, color: '#101828', fontSize: 18, marginTop: 20, paddingHorizontal: 16, paddingVertical: 14, textAlign: 'center' },
  error: { color: '#B42318', fontSize: 12, marginTop: 8, textAlign: 'center' },
  primary: { alignItems: 'center', backgroundColor: '#075BFF', borderRadius: 18, marginTop: 16, paddingVertical: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondary: { alignItems: 'center', marginTop: 8, paddingVertical: 12 },
  secondaryText: { color: '#475467', fontSize: 15, fontWeight: '600' },
});
