import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { supabase } from '../../services/supabase';

function normalizePhone(value: string) {
  try { return parsePhoneNumberFromString(value.trim(), 'US')?.isValid() ? parsePhoneNumberFromString(value.trim(), 'US')?.number ?? '' : ''; }
  catch { return ''; }
}

export function SpeakAuthGate({ children }: PropsWithChildren) {
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const ensureSession = async () => {
    const client = supabase;
    if (!client) throw new Error('Supabase is unavailable.');
    const { data: existing } = await client.auth.getSession();
    if (existing.session) return existing.session;
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    if (!data.session?.user.id) throw new Error('Anonymous session was not created.');
    return data.session;
  };

  useEffect(() => {
    void ensureSession().then(async (session) => {
      const { data, error } = await supabase!.from('speak_profiles').select('display_name,phone_e164').eq('user_id', session.user.id).maybeSingle();
      if (error) throw error;
      setName(data?.display_name ?? ''); setPhone(data?.phone_e164 ?? ''); setReady(Boolean(data?.display_name && data.phone_e164));
    }).catch((error) => Alert.alert('Authentication unavailable', error instanceof Error ? error.message : 'Unable to create a session.')).finally(() => setChecking(false));
  }, []);

  const save = async () => {
    const displayName = name.trim(); const phoneE164 = normalizePhone(phone);
    if (!displayName || !phoneE164) return Alert.alert('Complete your calling profile', 'Enter your name and a valid mobile phone number.');
    setSaving(true);
    try {
      const session = await ensureSession();
      const { error } = await supabase!.from('speak_profiles').upsert({ user_id: session.user.id, display_name: displayName, phone_e164: phoneE164, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw error;
      setPhone(phoneE164); setReady(true);
    } catch (error) { Alert.alert('Registration unavailable', error instanceof Error ? error.message : 'Unable to save your profile.'); }
    finally { setSaving(false); }
  };

  if (checking) return <View style={styles.center}><ActivityIndicator color="#075BFF" /></View>;
  if (ready) return <>{children}</>;
  return <View style={styles.page}><Text style={styles.title}>Set up calling</Text><Text style={styles.body}>Your name and mobile number let other Interpreter users call you.</Text><TextInput autoCapitalize="words" onChangeText={setName} placeholder="Name" style={styles.input} value={name}/><TextInput keyboardType="phone-pad" onChangeText={setPhone} placeholder="Mobile phone number" style={styles.input} value={phone}/><Pressable disabled={saving} onPress={() => void save()} style={styles.button}><Text style={styles.buttonText}>{saving ? 'Saving...' : 'Continue'}</Text></Pressable></View>;
}
const styles = StyleSheet.create({ center:{alignItems:'center',backgroundColor:'#F8FBFF',flex:1,justifyContent:'center'},page:{backgroundColor:'#F8FBFF',flex:1,justifyContent:'center',padding:28},title:{color:'#101828',fontSize:30,fontWeight:'800'},body:{color:'#667085',fontSize:16,lineHeight:23,marginTop:10},input:{backgroundColor:'#FFF',borderColor:'#DDE5F1',borderRadius:12,borderWidth:1,fontSize:16,marginTop:16,padding:15},button:{alignItems:'center',backgroundColor:'#075BFF',borderRadius:12,marginTop:22,padding:16},buttonText:{color:'#FFF',fontSize:17,fontWeight:'700'} });