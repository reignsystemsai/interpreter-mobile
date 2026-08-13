import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { API_BASE_URL } from '../../config/runtime';
import { authenticatedRequest } from '../../services/api';
import { deviceDefaultPhoneRegion, normalizeE164, registerDeviceInstallation } from '../../services/deviceRegistration';
import { supabase } from '../../services/supabase';
import { useAuth } from './AuthProvider';

type AccountResponse = { profile?: { full_name?: string | null; phone?: string | null } | null };
type RegistrationFailure = 'AUTH' | 'PROFILE_WRITE' | 'DEVICE_BIND' | 'ROUTE';

async function requestWithSession<T>(path: string, session: Session, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

export function CallableIdentityGate({ children }: PropsWithChildren) {
  const { configured, initializing, session, user } = useAuth();
  const [checking, setChecking] = useState(true);
  const [complete, setComplete] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<RegistrationFailure | null>(null);
  const [failureMessage, setFailureMessage] = useState('');

  useEffect(() => {
    if (initializing) return;
    if (!configured || !user) {
      setChecking(false);
      return;
    }
    void authenticatedRequest<AccountResponse>('/api/v1/account/me').then((account) => {
      const profileName = account.profile?.full_name?.trim() ?? '';
      const profilePhone = account.profile?.phone?.trim() ?? '';
      setName(profileName);
      setPhone(profilePhone);
      setComplete(Boolean(profileName && normalizeE164(profilePhone)));
    }).catch(() => setComplete(false)).finally(() => setChecking(false));
  }, [configured, initializing, user]);

  const save = async () => {
    const fullName = name.trim();
    const phoneE164 = normalizeE164(phone, deviceDefaultPhoneRegion());
    if (!fullName || !phoneE164) {
      Alert.alert('Complete your calling profile', 'Enter your name and a valid mobile phone number.');
      return;
    }
    setSaving(true);
    setFailure(null);
    setFailureMessage('');
    try {
      const client = supabase;
      if (!client) throw new Error('AUTH');
      const { data: currentSession } = await client.auth.getSession();
      let activeSession = currentSession.session;
      if (!activeSession) {
        const { data, error } = await client.auth.signInAnonymously();
        if (error) {
          setFailure('AUTH');
          setFailureMessage(error.message);
          return;
        }
        activeSession = data.session;
      }
      if (!activeSession?.user.id || !activeSession.access_token) throw new Error('AUTH');
      try {
        await requestWithSession('/api/v1/account/me', activeSession, { method: 'PATCH', body: JSON.stringify({ fullName, phone: phoneE164 }) });
      } catch {
        throw new Error('PROFILE_WRITE');
      }
      try {
        await registerDeviceInstallation(phoneE164, deviceDefaultPhoneRegion(), activeSession.access_token);
      } catch {
        throw new Error('DEVICE_BIND');
      }
      let confirmed: AccountResponse;
      try {
        confirmed = await requestWithSession<AccountResponse>('/api/v1/account/me', activeSession);
      } catch {
        throw new Error('ROUTE');
      }
      if (
        confirmed.profile?.full_name?.trim() !== fullName ||
        normalizeE164(confirmed.profile?.phone ?? '') !== phoneE164
      ) throw new Error('PROFILE_WRITE');
      setPhone(phoneE164);
      setComplete(true);
    } catch (error) {
      const code: RegistrationFailure = error instanceof Error && ['AUTH', 'PROFILE_WRITE', 'DEVICE_BIND', 'ROUTE'].includes(error.message)
        ? error.message as RegistrationFailure
        : 'ROUTE';
      setFailure(code);
    } finally {
      setSaving(false);
    }
  };

  if (initializing || checking) return <View style={styles.loading}><ActivityIndicator color="#075BFF" /><Text style={styles.loadingText}>Checking calling profile...</Text></View>;
  if (complete) return <>{children}</>;

  return <View style={styles.page}>
    <Text style={styles.title}>Set up calling</Text>
    <Text style={styles.body}>Your name and mobile number let other Interpreter users call this device.</Text>
    <TextInput autoCapitalize="words" onChangeText={setName} placeholder="Name" style={styles.input} value={name} />
    <TextInput keyboardType="phone-pad" onChangeText={setPhone} placeholder="Mobile phone number" style={styles.input} value={phone} />
    {failure ? <Text style={styles.failure}>Registration failed: {failure}{failureMessage ? ` - ${failureMessage}` : ''}</Text> : null}
    <Pressable accessibilityRole="button" disabled={saving} onPress={() => void save()} style={[styles.button, saving && styles.disabled]}><Text style={styles.buttonText}>{saving ? 'Saving...' : 'Continue'}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', backgroundColor: '#F8FBFF', flex: 1, justifyContent: 'center' }, loadingText: { color: '#344054', marginTop: 12 }, page: { backgroundColor: '#F8FBFF', flex: 1, justifyContent: 'center', padding: 28 }, title: { color: '#101828', fontSize: 30, fontWeight: '800' }, body: { color: '#667085', fontSize: 16, lineHeight: 23, marginTop: 10 }, input: { backgroundColor: '#FFFFFF', borderColor: '#DDE5F1', borderRadius: 12, borderWidth: 1, color: '#101828', fontSize: 16, marginTop: 16, paddingHorizontal: 15, paddingVertical: 14 }, failure: { color: '#B42318', fontSize: 14, fontWeight: '700', marginTop: 12 }, button: { alignItems: 'center', backgroundColor: '#075BFF', borderRadius: 12, marginTop: 22, paddingVertical: 16 }, buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' }, disabled: { opacity: 0.5 },
});