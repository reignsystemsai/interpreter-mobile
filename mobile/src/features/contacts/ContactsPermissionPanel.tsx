import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Contacts from 'expo-contacts';

type PermissionState = 'checking' | 'undetermined' | 'granted' | 'denied';

export function ContactsPermissionPanel({ onBack }: { onBack: () => void }) {
  const [permission, setPermission] = useState<PermissionState>('checking');

  useEffect(() => {
    void Contacts.getPermissionsAsync()
      .then(({ status }) => setPermission(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'))
      .catch(() => setPermission('undetermined'));
  }, []);

  const requestPermission = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    setPermission(status === 'granted' ? 'granted' : 'denied');
  };

  return (
    <View>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Calling</Text></Pressable>
      <Text style={styles.title}>My Contacts</Text>
      <Text style={styles.body}>Allow Interpreter to access contacts only when you are ready. Phase 1 does not read, upload, or synchronize any contact records.</Text>
      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Contacts permission</Text>
        <Text style={styles.statusValue}>{permission === 'checking' ? 'Checking…' : permission === 'granted' ? 'Allowed' : permission === 'denied' ? 'Not allowed' : 'Not requested'}</Text>
      </View>
      <Pressable accessibilityRole="button" disabled={permission === 'checking'} onPress={() => void requestPermission().catch(() => Alert.alert('Unable to request contacts permission'))} style={styles.primary}><Text style={styles.primaryText}>Allow Contacts</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.secondary}><Text style={styles.secondaryText}>Not Now</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => Alert.alert('Contacts stopped', 'Contact syncing has not been enabled in this phase.')} style={styles.secondary}><Text style={styles.secondaryText}>Stop Syncing</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => Alert.alert('No imported contacts', 'Interpreter has not imported any contacts.')} style={styles.danger}><Text style={styles.dangerText}>Delete Imported Contacts</Text></Pressable>
    </View>
  );
}

const BLUE = '#075BFF';
const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', marginBottom: 12, paddingVertical: 5 },
  backText: { color: BLUE, fontSize: 16, fontWeight: '600' },
  title: { color: '#101828', fontSize: 27, fontWeight: '800' },
  body: { color: '#667085', fontSize: 15, lineHeight: 22, marginTop: 10 },
  statusCard: { backgroundColor: 'rgba(255,255,255,0.74)', borderColor: 'rgba(117,151,213,0.22)', borderRadius: 18, borderWidth: 1, marginTop: 20, padding: 16 },
  statusLabel: { color: '#667085', fontSize: 13 },
  statusValue: { color: '#101828', fontSize: 17, fontWeight: '700', marginTop: 4 },
  primary: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 18, marginTop: 18, paddingVertical: 15 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondary: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.74)', borderRadius: 18, marginTop: 10, paddingVertical: 14 },
  secondaryText: { color: '#174EA6', fontSize: 15, fontWeight: '600' },
  danger: { alignItems: 'center', marginTop: 12, paddingVertical: 13 },
  dangerText: { color: '#D92D20', fontSize: 15, fontWeight: '600' },
});
