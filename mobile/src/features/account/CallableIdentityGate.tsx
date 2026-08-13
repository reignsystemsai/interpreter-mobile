import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { authenticatedRequest } from '../../services/api';
import { deviceDefaultPhoneRegion, normalizeE164, registerDeviceInstallation } from '../../services/deviceRegistration';
import { useAuth } from './AuthProvider';

type AccountResponse = { profile?: { full_name?: string | null; phone?: string | null } | null };

export function CallableIdentityGate({ children }: PropsWithChildren) {
  const { configured, initializing, user } = useAuth();
  const [checking, setChecking] = useState(true);
  const [complete, setComplete] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

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
    try {
      await authenticatedRequest('/api/v1/account/me', { method: 'PATCH', body: JSON.stringify({ fullName, phone: phoneE164 }) });
      await registerDeviceInstallation(phoneE164);
      setPhone(phoneE164);
      setComplete(true);
    } catch (error) {
      Alert.alert('Registration unavailable', error instanceof Error ? error.message : 'Unable to save your calling profile.');
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
    <Pressable accessibilityRole="button" disabled={saving} onPress={() => void save()} style={[styles.button, saving && styles.disabled]}><Text style={styles.buttonText}>{saving ? 'Saving...' : 'Continue'}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', backgroundColor: '#F8FBFF', flex: 1, justifyContent: 'center' }, loadingText: { color: '#344054', marginTop: 12 }, page: { backgroundColor: '#F8FBFF', flex: 1, justifyContent: 'center', padding: 28 }, title: { color: '#101828', fontSize: 30, fontWeight: '800' }, body: { color: '#667085', fontSize: 16, lineHeight: 23, marginTop: 10 }, input: { backgroundColor: '#FFFFFF', borderColor: '#DDE5F1', borderRadius: 12, borderWidth: 1, color: '#101828', fontSize: 16, marginTop: 16, paddingHorizontal: 15, paddingVertical: 14 }, button: { alignItems: 'center', backgroundColor: '#075BFF', borderRadius: 12, marginTop: 22, paddingVertical: 16 }, buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' }, disabled: { opacity: 0.5 },
});