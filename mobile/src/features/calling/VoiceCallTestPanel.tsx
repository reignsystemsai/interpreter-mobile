import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CallService } from './CallService';

export function VoiceCallTestPanel({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (error) { Alert.alert('Unable to connect', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  return <View>
    <Pressable onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Calling</Text></Pressable>
    <Text style={styles.title}>Voice Call Test</Text>
    <Text style={styles.body}>Start on the first phone, then enter its temporary code on the second phone.</Text>
    <Pressable disabled={busy} onPress={() => void run(() => CallService.startVoiceCall())} style={styles.primary}><Text style={styles.primaryText}>{busy ? 'Connecting...' : 'Start Voice Call'}</Text></Pressable>
    <Text style={styles.or}>OR JOIN A CALL</Text>
    <TextInput autoCapitalize="characters" autoCorrect={false} onChangeText={setCode} placeholder="Enter call code" style={styles.input} value={code} />
    <Pressable disabled={busy} onPress={() => void run(() => CallService.joinVoiceCall(code))} style={styles.secondary}><Text style={styles.secondaryText}>Join Voice Call</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', marginBottom: 10, paddingVertical: 5 }, backText: { color: '#075BFF', fontSize: 16, fontWeight: '600' },
  title: { color: '#101828', fontSize: 27, fontWeight: '800' }, body: { color: '#667085', fontSize: 15, lineHeight: 22, marginTop: 10 },
  primary: { alignItems: 'center', backgroundColor: '#075BFF', borderRadius: 22, marginTop: 28, paddingVertical: 16 }, primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  or: { color: '#667085', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 28, textAlign: 'center' },
  input: { backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 18, color: '#101828', fontSize: 18, fontWeight: '700', letterSpacing: 1.5, marginTop: 12, paddingHorizontal: 16, paddingVertical: 14, textAlign: 'center' },
  secondary: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.54)', borderRadius: 22, marginTop: 12, paddingVertical: 15 }, secondaryText: { color: '#075BFF', fontSize: 16, fontWeight: '700' },
});
