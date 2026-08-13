import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { createCallableIdentity } from './CallableIdentity';

export function CallingSetup({ onCancel, onComplete, visible }: {
  onCancel: () => void;
  onComplete: () => void;
  visible: boolean;
}) {
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const continueSetup = async () => {
    setBusy(true);
    setError('');
    try {
      await createCallableIdentity(displayName, phone);
      onComplete();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Calling setup could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>Calling setup</Text>
          <Text style={styles.body}>Add your name and phone so friends can reach you.</Text>
          <TextInput autoCapitalize="words" onChangeText={setDisplayName} placeholder="Name" placeholderTextColor="#98A2B3" style={styles.input} value={displayName} />
          <TextInput keyboardType="phone-pad" onChangeText={setPhone} placeholder="Phone with country code" placeholderTextColor="#98A2B3" style={styles.input} value={phone} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void continueSetup()} style={[styles.primary, busy && styles.disabled]}><Text style={styles.primaryText}>{busy ? 'Saving...' : 'Continue'}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.secondary}><Text style={styles.secondaryText}>Not now</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const BLUE = '#075BFF';
const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(8,18,38,0.22)', flex: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#F8FBFF', borderRadius: 26, maxWidth: 420, padding: 22, width: '100%' },
  title: { color: '#101828', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: { color: '#667085', fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: 'center' },
  input: { backgroundColor: '#FFFFFF', borderColor: '#DDE5F1', borderRadius: 15, borderWidth: 1, color: '#101828', fontSize: 15, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 19, marginTop: 10 },
  primary: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 18, marginTop: 16, paddingVertical: 15 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { color: '#174EA6', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});