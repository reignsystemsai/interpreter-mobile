import { useState } from 'react';
import { BlurView } from 'expo-blur';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { createCallableIdentity, ensureCallableIdentity } from './CallableIdentity';

export function CallingSetup({ onCancel, onComplete, required = false, visible }: {
  onCancel: () => void;
  onComplete: () => void;
  required?: boolean;
  visible: boolean;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const continueSetup = async () => {
    setBusy(true);
    setError('');
    try {
      const identity = await createCallableIdentity(firstName, lastName, phone, email);
      void identity;
      await ensureCallableIdentity();
      onComplete();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Calling setup could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={required ? () => undefined : onCancel} transparent visible={visible}>
      <View style={styles.backdrop}>
        <BlurView accessibilityViewIsModal experimentalBlurMethod="dimezisBlurView" intensity={52} style={styles.card} tint="light">
          <Text style={styles.title}>Register for Speak</Text>
          <Text style={styles.body}>Enter your basic information once so Speak can recognize you and receive calls.</Text>
          <TextInput autoCapitalize="words" onChangeText={setFirstName} placeholder="First name" placeholderTextColor="#98A2B3" style={styles.input} value={firstName} />
          <TextInput autoCapitalize="words" onChangeText={setLastName} placeholder="Last name" placeholderTextColor="#98A2B3" style={styles.input} value={lastName} />
          <TextInput keyboardType="phone-pad" onChangeText={setPhone} placeholder="Phone with country code" placeholderTextColor="#98A2B3" style={styles.input} value={phone} />
          <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="email-address" onChangeText={setEmail} placeholder="Email" placeholderTextColor="#98A2B3" style={styles.input} value={email} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void continueSetup()} style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && styles.pressed]}><Text style={styles.primaryText}>{busy ? 'Saving...' : 'Continue'}</Text></Pressable>
          {!required ? <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.secondary}><Text style={styles.secondaryText}>Not now</Text></Pressable> : null}
        </BlurView>
      </View>
    </Modal>
  );
}

const BLUE = '#075BFF';
const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(8,18,38,0.16)', flex: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: 'rgba(248,251,255,0.54)', borderColor: 'rgba(255,255,255,0.72)', borderRadius: 26, borderWidth: 1, maxWidth: 420, overflow: 'hidden', padding: 22, width: '100%' },
  title: { color: '#101828', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: { color: '#667085', fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: 'center' },
  input: { backgroundColor: 'rgba(255,255,255,0.58)', borderColor: 'rgba(255,255,255,0.82)', borderRadius: 15, borderWidth: 1, color: '#101828', fontSize: 15, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 19, marginTop: 10 },
  primary: { alignItems: 'center', backgroundColor: BLUE, borderColor: 'rgba(255,255,255,0.48)', borderRadius: 28, borderWidth: 1, justifyContent: 'center', marginTop: 18, minHeight: 54, shadowColor: '#075BFF', shadowOffset: { height: 7, width: 0 }, shadowOpacity: 0.22, shadowRadius: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { color: '#174EA6', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
});
