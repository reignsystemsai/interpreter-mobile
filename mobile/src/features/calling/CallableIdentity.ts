import * as SecureStore from 'expo-secure-store';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { supabase } from '../../services/supabase';

const SETUP_COMPLETE_KEY = 'interpreter.calling.setup_complete';

export function normalizePhone(phone: string) {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed || !parsed.isValid()) throw new Error('Enter a valid phone number with country code.');
  return parsed.number;
}

export async function getCallableIdentity() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('speak_profiles').select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return data ? { phoneE164: '', userId: session.user.id } : null;
}

export async function createCallableIdentity(displayName: string, phone: string) {
  const normalizedName = displayName.trim();
  if (!normalizedName) throw new Error('Enter your name.');
  const phoneE164 = normalizePhone(phone);
  const { data: { session: existingSession } } = await supabase.auth.getSession();
  let session = existingSession;
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session) throw new Error('Calling setup could not connect. Try again.');
    session = data.session;
  }
  const { error } = await supabase.from('speak_profiles').upsert({
    display_name: normalizedName,
    phone_e164: phoneE164,
    user_id: session.user.id,
  }, { onConflict: 'user_id' });
  if (error) throw new Error('Calling setup could not be saved. Try again.');
  await SecureStore.setItemAsync(SETUP_COMPLETE_KEY, 'true');
  return { phoneE164, userId: session.user.id };
}