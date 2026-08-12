// Temporary Phase 3 test screen — exercises the canonical BackendCallDataShell +
// CallingShellImpl (via CallingShellHost) + BackendMediaAdapter path against the real
// speak_call_sessions backend and LiveKit. Not linked from Home by design. Reach it
// directly via the deep link interpreterai://phase3-test.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { API_BASE_URL } from '../src/config/runtime';
import { getDeviceId } from '../src/services/deviceRegistration';
import { backendMediaAdapter } from '../src/shells/audio/BackendMediaAdapter';
import { CallingShellHost } from '../src/shells/calling/CallingShellHost';
import type { CallSession } from '../src/shells/data/CallSession';

type IncomingLookup = {
  incoming: boolean;
  callId?: string;
  callerDeviceId?: string;
  callerPhoneNumber?: string;
};

type Message = { kind: 'success' | 'error'; text: string } | null;

const INITIAL_FORM = { callerLanguage: 'en', recipientLanguage: 'es', recipientPhoneNumber: '' };

export default function Phase3TestScreen() {
  const [deviceId, setDeviceId] = useState('');
  const [form, setForm] = useState(INITIAL_FORM);
  const [session, setSession] = useState<CallSession | null>(CallingShellHost.getSession());
  const [incoming, setIncoming] = useState<IncomingLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void getDeviceId().then(setDeviceId);
    return CallingShellHost.subscribe(setSession);
  }, []);

  const pollIncoming = useCallback(async () => {
    if (!deviceId || CallingShellHost.getSession()) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/call-sessions/incoming?deviceId=${encodeURIComponent(deviceId)}`);
      const payload = (await response.json()) as IncomingLookup;
      setIncoming(payload.incoming ? payload : null);
    } catch {
      // Silent — this is a background poll; errors surface only through explicit actions.
    }
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    void pollIncoming();
    pollRef.current = setInterval(() => void pollIncoming(), 2_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [deviceId, pollIncoming]);

  const handleCreateCall = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const callerDeviceId = await getDeviceId();
      const created = await CallingShellHost.createCall({
        callerDeviceId,
        recipientPhoneNumber: form.recipientPhoneNumber,
        recipientUserId: 'phase3-recipient-user',
        callerLanguage: form.callerLanguage,
        recipientLanguage: form.recipientLanguage,
      });
      await backendMediaAdapter.connect(created.callId, 'Phase 3 Test (caller)', 'caller');
      setMessage({ kind: 'success', text: `Call created: ${created.callId}` });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Create call failed.' });
    } finally {
      setBusy(false);
    }
  }, [form]);

  const handleAnswer = useCallback(async () => {
    if (!incoming?.callId) return;
    setBusy(true);
    setMessage(null);
    try {
      await CallingShellHost.answerCall(incoming.callId);
      await backendMediaAdapter.connect(incoming.callId, 'Phase 3 Test (recipient)', 'recipient');
      setMessage({ kind: 'success', text: `Answered: ${incoming.callId}` });
      setIncoming(null);
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Answer failed.' });
    } finally {
      setBusy(false);
    }
  }, [incoming]);

  const handleEnd = useCallback(async () => {
    const current = CallingShellHost.getSession();
    if (!current) return;
    setBusy(true);
    setMessage(null);
    try {
      await CallingShellHost.endCall(current.callId);
      setMessage({ kind: 'success', text: 'Call ended.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'End call failed.' });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setForm(INITIAL_FORM);
    setIncoming(null);
    setMessage(null);
  }, []);

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Phase 3 — Canonical Call Foundation Test</Text>
        <Text style={styles.subtitle}>BackendCallDataShell + CallingShellImpl + BackendMediaAdapter</Text>

        <View style={styles.section}>
          <Text style={styles.label}>This device ID</Text>
          <Text style={styles.value}>{deviceId || 'loading…'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Current call ID</Text>
          <Text style={styles.value}>{session?.callId ?? 'none'}</Text>
          <Text style={styles.label}>Current call status</Text>
          <Text style={styles.value}>{session?.status ?? 'idle'}</Text>
        </View>

        {message ? (
          <Text style={[styles.message, message.kind === 'error' ? styles.messageError : styles.messageSuccess]}>{message.text}</Text>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Create outgoing call</Text>
          <Text style={styles.label}>Recipient phone number</Text>
          <TextInput autoCapitalize="none" keyboardType="phone-pad" onChangeText={(value) => setForm((current) => ({ ...current, recipientPhoneNumber: value }))} placeholder="+15551234567" placeholderTextColor="#667" style={styles.input} value={form.recipientPhoneNumber} />
          <Text style={styles.label}>Caller language</Text>
          <TextInput autoCapitalize="none" onChangeText={(value) => setForm((current) => ({ ...current, callerLanguage: value }))} placeholder="en" placeholderTextColor="#667" style={styles.input} value={form.callerLanguage} />
          <Text style={styles.label}>Recipient language</Text>
          <TextInput autoCapitalize="none" onChangeText={(value) => setForm((current) => ({ ...current, recipientLanguage: value }))} placeholder="es" placeholderTextColor="#667" style={styles.input} value={form.recipientLanguage} />
          <Pressable disabled={busy || !form.recipientPhoneNumber} onPress={() => void handleCreateCall()} style={[styles.button, (busy || !form.recipientPhoneNumber) && styles.buttonDisabled]}>
            <Text style={styles.buttonText}>Create Call</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Incoming call</Text>
          {incoming?.callId ? (
            <>
              <Text style={styles.value}>From: {incoming.callerPhoneNumber || incoming.callerDeviceId}</Text>
              <Text style={styles.value}>Call ID: {incoming.callId}</Text>
              <Pressable disabled={busy} onPress={() => void handleAnswer()} style={[styles.button, busy && styles.buttonDisabled]}>
                <Text style={styles.buttonText}>Answer Call</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.waitingRow}>
              <ActivityIndicator color="#8792AE" size="small" />
              <Text style={styles.waiting}>Waiting for incoming call… (polling every 2s)</Text>
            </View>
          )}
        </View>

        <Pressable disabled={busy || !session} onPress={() => void handleEnd()} style={[styles.button, styles.endButton, (busy || !session) && styles.buttonDisabled]}>
          <Text style={styles.buttonText}>End Call</Text>
        </Pressable>

        <Pressable onPress={handleReset} style={[styles.button, styles.resetButton]}>
          <Text style={styles.buttonText}>Reset</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#050B18', flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  title: { color: '#F3F6FF', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#5B6689', fontSize: 11, marginTop: 4 },
  section: { marginTop: 22 },
  sectionTitle: { color: '#F3F6FF', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  label: { color: '#8792AE', fontSize: 12, marginBottom: 4, marginTop: 8 },
  value: { color: '#F3F6FF', fontSize: 13 },
  message: { borderRadius: 10, fontSize: 13, marginTop: 16, padding: 10 },
  messageSuccess: { backgroundColor: 'rgba(62,255,150,0.12)', color: '#4CFFA0' },
  messageError: { backgroundColor: 'rgba(255,107,107,0.12)', color: '#FF6B6B' },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(120,160,255,0.2)', borderRadius: 10, borderWidth: 1, color: '#F3F6FF', height: 44, paddingHorizontal: 12 },
  button: { alignItems: 'center', backgroundColor: '#3E8BFF', borderRadius: 10, height: 46, justifyContent: 'center', marginTop: 12 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  endButton: { backgroundColor: '#B4232F', marginTop: 24 },
  resetButton: { backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 10 },
  waitingRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  waiting: { color: '#8792AE', fontSize: 12 },
});
