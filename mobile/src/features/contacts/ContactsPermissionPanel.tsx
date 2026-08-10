import { useEffect, useMemo, useRef, useState } from 'react';
import * as Contacts from 'expo-contacts';
import type { CountryCode } from 'libphonenumber-js';
import { Alert, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { type InterpreterContact, useContacts } from './ContactsProvider';
import { InterpreterCallSetup, type InterpreterCallOptions } from '../calling/InterpreterCallSetup';
import { VoiceCallService } from '../calling/VoiceCallService';
import { useLanguagePreferences } from '../languages/LanguagePreferencesProvider';
import { backendMediaAdapter } from '../../shells/audio/BackendMediaAdapter';
import { CallingShellHost } from '../../shells/calling/CallingShellHost';
import {
  deviceDefaultPhoneRegion,
  getDeviceId,
  getRegisteredPhoneNumber,
  lookupDeviceByPhone,
  normalizeE164,
  normalizePhoneRegion,
  phoneRegionFromE164,
  registerDeviceInstallation,
} from '../../services/deviceRegistration';

const APP_DOWNLOAD_URL = 'https://interpreter.ai/download';
const BLUE = '#075BFF';
type CallLaunchOptions = { interpreter: boolean; video: boolean; voiceGender: 'female' | 'male' };
const STANDARD_VOICE_CALL: CallLaunchOptions = { interpreter: false, video: false, voiceGender: 'male' };

export function ContactsPermissionPanel({ autoRequest = false, onBack }: { autoRequest?: boolean; onBack: () => void }) {
  const { contacts, error, loading, permission, refresh, requestAndImport } = useContacts();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const automaticRequestStarted = useRef(false);
  const selected = contacts.find((contact) => contact.id === selectedId) ?? null;

  useEffect(() => {
    if (!autoRequest || permission !== 'undetermined' || automaticRequestStarted.current) return;
    automaticRequestStarted.current = true;
    void requestAndImport().catch(() => undefined);
  }, [autoRequest, permission, requestAndImport]);

  const visibleContacts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (!normalized) return true;
      return [contact.displayName, contact.company, contact.phoneNumbers.map((item) => item.value).join(' ')]
        .join(' ').toLowerCase().includes(normalized);
    }).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [contacts, query]);

  if (selected) return <ContactDetails contact={selected} onBack={() => setSelectedId(null)} onRefresh={refresh} />;

  if (permission !== 'granted' && !contacts.length) return (
    <View>
      <Header onBack={onBack} />
      <Text style={styles.title}>My Contacts</Text>
      <Text style={styles.body}>Allow access to display contacts stored on this device.</Text>
      <View style={styles.statusCard}><Text style={styles.statusLabel}>Contacts permission</Text><Text style={styles.statusValue}>{permissionLabel(permission)}</Text></View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {permission === 'blocked' || permission === 'denied'
        ? <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
        : <PrimaryButton disabled={loading || permission === 'checking'} label={loading ? 'Loading…' : 'Allow Contacts'} onPress={() => void requestAndImport().catch((nextError) => Alert.alert('Unable to load contacts', nextError instanceof Error ? nextError.message : 'Contacts could not be loaded right now.'))} />}
      <SecondaryButton label="Not Now" onPress={onBack} />
    </View>
  );

  return (
    <View style={styles.listScreen}>
      <Header onBack={onBack} />
      <View style={styles.titleRow}><Text style={styles.title}>My Contacts</Text><Pressable accessibilityLabel="Reload device contacts" onPress={() => void refresh()} style={styles.reloadButton}><Text style={styles.reloadText}>Reload</Text></Pressable></View>
      <TextInput autoCapitalize="none" onChangeText={setQuery} placeholder="Search contacts" placeholderTextColor="#98A2B3" style={styles.search} value={query} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.contactList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {loading ? <Text style={styles.empty}>Loading contacts…</Text> : visibleContacts.map((contact) => (
          <Pressable key={contact.id} onPress={() => setSelectedId(contact.id)} style={({ pressed }) => [styles.contactRow, pressed && styles.pressed]}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.contactCopy}><Text numberOfLines={1} style={styles.contactName}>{contact.displayName}</Text><Text numberOfLines={1} style={styles.contactMeta}>{contact.phoneNumbers[0]?.value || 'No phone number'}</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
        {!loading && !visibleContacts.length ? <Text style={styles.empty}>No contacts found.</Text> : null}
      </ScrollView>
    </View>
  );
}

function permissionLabel(permission: ReturnType<typeof useContacts>['permission']) {
  if (permission === 'checking') return 'Checking…';
  if (permission === 'granted') return 'Allowed';
  if (permission === 'blocked') return 'Blocked in Settings';
  if (permission === 'denied') return 'Not allowed';
  return 'Not requested';
}

function ContactDetails({ contact, onBack, onRefresh }: { contact: InterpreterContact; onBack: () => void; onRefresh: () => Promise<void> }) {
  const { languageOne, languageTwo } = useLanguagePreferences();
  const [busy, setBusy] = useState(false);
  const [launchingMode, setLaunchingMode] = useState<'video' | 'voice' | null>(null);
  const [creatingCall, setCreatingCall] = useState(false);
  const [showInterpreterSetup, setShowInterpreterSetup] = useState(false);
  const [numberPromptVisible, setNumberPromptVisible] = useState(false);
  const [ownPhoneNumber, setOwnPhoneNumber] = useState('');
  const [pendingContactPhone, setPendingContactPhone] = useState('');
  const [pendingContactRegion, setPendingContactRegion] = useState<CountryCode>(deviceDefaultPhoneRegion());
  const [pendingCallerLanguage, setPendingCallerLanguage] = useState('English');
  const [pendingRecipientLanguage, setPendingRecipientLanguage] = useState('Spanish');
  const [pendingCallOptions, setPendingCallOptions] = useState<CallLaunchOptions>(STANDARD_VOICE_CALL);
  const [registrationError, setRegistrationError] = useState('');

  const invite = async () => {
    await Share.share({ message: `Download Interpreter so I can speak to you in your language.\n\n${APP_DOWNLOAD_URL}` });
  };

  const editNativeContact = async () => {
    if (!contact.deviceContactId) return;
    try {
      await Contacts.presentFormAsync(contact.deviceContactId);
      await onRefresh();
      onBack();
    } catch {
      Alert.alert('Unable to open contact', 'Open the Contacts app to edit this contact.');
    }
  };

  const startContactCall = async (phoneNumberE164: string, defaultRegion: CountryCode, callerLanguage: string, recipientLanguage: string, options: CallLaunchOptions = STANDARD_VOICE_CALL) => {
    let createdCallId: string | null = null;
    try {
      const recipient = await lookupDeviceByPhone(phoneNumberE164, defaultRegion);
      if (!recipient.found) throw new Error('This person does not have Interpreter yet.');
      const callerDeviceId = await getDeviceId();
      const session = await CallingShellHost.createCall({ callerDeviceId, recipientPhoneNumber: phoneNumberE164, callerLanguage, recipientLanguage });
      createdCallId = session.callId;
      await backendMediaAdapter.connect(session.callId, contact.displayName, 'caller', options.interpreter ? 'interpreter' : options.video ? 'video' : 'voice');
      if (options.interpreter) await VoiceCallService.setInterpreterEnabled(true, options.voiceGender);
      if (options.video) await VoiceCallService.enableVideo();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.';
      if (message === 'This person does not have Interpreter yet.') {
        Alert.alert('Invite to Interpreter', undefined, [
          { text: 'Cancel', style: 'cancel', onPress: () => void VoiceCallService.resetVoiceCall({ notifyBackend: false }) },
          { text: 'Invite to Interpreter', onPress: () => void invite().finally(() => VoiceCallService.resetVoiceCall({ notifyBackend: false })) },
        ]);
      } else {
        if (createdCallId) void CallingShellHost.endCall(createdCallId).catch(() => undefined);
        void VoiceCallService.disconnectMedia();
        Alert.alert('Unable to connect', message);
      }
    }
  };

  const choosePhoneForCall = async (phoneNumberE164: string, region: CountryCode, callerLanguage: string, recipientLanguage: string, options: CallLaunchOptions = STANDARD_VOICE_CALL) => {
    const registeredPhone = await getRegisteredPhoneNumber().catch(() => null);
    if (!registeredPhone) {
      setPendingContactPhone(phoneNumberE164);
      setPendingContactRegion(region);
      setPendingCallerLanguage(callerLanguage);
      setPendingRecipientLanguage(recipientLanguage);
      setPendingCallOptions(options);
      setNumberPromptVisible(true);
      return;
    }
    await startContactCall(phoneNumberE164, region, callerLanguage, recipientLanguage, options);
  };

  const beginVoiceCall = async (callerLanguage: string, recipientLanguage: string, options: CallLaunchOptions = STANDARD_VOICE_CALL) => {
    if (options.video) await VoiceCallService.requestMediaPermissions(true);
    const registeredPhone = await getRegisteredPhoneNumber().catch(() => null);
    const fallbackRegion = phoneRegionFromE164(registeredPhone) ?? deviceDefaultPhoneRegion();
    const firstValidPhone = contact.phoneNumbers.find((item) => {
      const region = normalizePhoneRegion(item.countryCode) ?? fallbackRegion;
      return Boolean(normalizeE164(item.value, region));
    });
    if (!firstValidPhone) {
      Alert.alert('This contact has no phone number saved.', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Edit Contact', onPress: () => void editNativeContact() },
      ]);
      return;
    }
    const region = normalizePhoneRegion(firstValidPhone.countryCode) ?? fallbackRegion;
    const phoneNumberE164 = normalizeE164(firstValidPhone.value, region);
    if (!phoneNumberE164) return;
    await choosePhoneForCall(phoneNumberE164, region, callerLanguage, recipientLanguage, options);
  };

  const registerAndCall = async () => {
    setBusy(true);
    setRegistrationError('');
    try {
      await registerDeviceInstallation(ownPhoneNumber);
      setNumberPromptVisible(false);
      await startContactCall(pendingContactPhone, pendingContactRegion, pendingCallerLanguage, pendingRecipientLanguage, pendingCallOptions);
    } catch (error) {
      setRegistrationError(error instanceof Error ? error.message : 'Unable to register this phone number.');
    } finally {
      setBusy(false);
    }
  };

  if (showInterpreterSetup) return <>
    <InterpreterCallSetup
      contact={contact}
      creating={creatingCall}
      initialCallerLanguage={languageOne}
      initialRecipientLanguage={languageTwo}
      onBack={() => setShowInterpreterSetup(false)}
      onStart={(options: InterpreterCallOptions) => {
        setCreatingCall(true);
        void beginVoiceCall(options.callerLanguage, options.recipientLanguage, { interpreter: true, video: options.callType === 'video', voiceGender: options.voiceGender }).finally(() => setCreatingCall(false));
      }}
    />
    <Modal animationType="fade" onRequestClose={() => setNumberPromptVisible(false)} transparent visible={numberPromptVisible}>
      <View style={styles.numberBackdrop}>
        <View accessibilityViewIsModal style={styles.numberCard}>
          <Text style={styles.numberTitle}>Your phone number</Text>
          <Text style={styles.numberBody}>Enter it once so this device can receive Interpreter calls.</Text>
          <TextInput keyboardType="phone-pad" onChangeText={setOwnPhoneNumber} placeholder="Include country code, e.g. +57" style={styles.input} value={ownPhoneNumber} />
          {registrationError ? <Text style={styles.error}>{registrationError}</Text> : null}
          <PrimaryButton disabled={busy} label={busy ? 'Saving…' : 'Continue'} onPress={() => void registerAndCall()} />
          <SecondaryButton label="Not Now" onPress={() => setNumberPromptVisible(false)} />
        </View>
      </View>
    </Modal>
  </>;

  return <>
    <ScrollView contentContainerStyle={styles.details} showsVerticalScrollIndicator={false}>
      <Pressable onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Contacts</Text></Pressable>
      <View style={styles.detailAvatar}><Text style={styles.detailAvatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text></View>
      <Text style={styles.detailName}>{contact.displayName}</Text>
      <Text style={styles.userStatus}>iPhone contact</Text>
      <View style={styles.callGrid}>
        <Pressable disabled={busy} onPress={() => { setLaunchingMode('voice'); setBusy(true); void beginVoiceCall(languageOne, languageTwo).finally(() => { setBusy(false); setLaunchingMode(null); }); }} style={styles.callButton}><CallIcon name="phone" /><Text style={styles.callLabel}>{launchingMode === 'voice' ? 'Calling…' : 'Call'}</Text></Pressable>
        <Pressable disabled={busy} onPress={() => { setLaunchingMode('video'); setBusy(true); void beginVoiceCall(languageOne, languageTwo, { interpreter: false, video: true, voiceGender: 'male' }).finally(() => { setBusy(false); setLaunchingMode(null); }); }} style={styles.callButton}><CallIcon name="video" /><Text style={styles.callLabel}>{launchingMode === 'video' ? 'Video Calling…' : 'Video Call'}</Text></Pressable>
        <Pressable disabled={busy} onPress={() => setShowInterpreterSetup(true)} style={[styles.callButton, styles.interpretButton]}><CallIcon name="interpret" /><Text style={[styles.callLabel, styles.interpretLabel]}>Interpret</Text></Pressable>
      </View>
      <PrimaryButton label="Invite to Interpreter" onPress={() => void invite().catch(() => Alert.alert('Unable to open invite'))} />
      <Text style={styles.sectionTitle}>Contact details</Text>
      <View style={styles.detailCard}>
        <Detail label="Phone" value={contact.phoneNumbers.map((item) => item.value).join('\n') || 'Not provided'} />
        <Detail label="Email" value={contact.emailAddresses.map((item) => item.value).join('\n') || 'Not provided'} />
        <Detail label="Company" value={contact.company || 'Not provided'} />
      </View>
      <SecondaryButton label="Edit in Contacts" onPress={() => void editNativeContact()} />
    </ScrollView>
    <Modal animationType="fade" onRequestClose={() => setNumberPromptVisible(false)} transparent visible={numberPromptVisible}>
      <View style={styles.numberBackdrop}>
        <View accessibilityViewIsModal style={styles.numberCard}>
          <Text style={styles.numberTitle}>Your phone number</Text>
          <Text style={styles.numberBody}>Enter it once so this device can receive Interpreter calls.</Text>
          <TextInput keyboardType="phone-pad" onChangeText={setOwnPhoneNumber} placeholder="Include country code, e.g. +57" style={styles.input} value={ownPhoneNumber} />
          {registrationError ? <Text style={styles.error}>{registrationError}</Text> : null}
          <PrimaryButton disabled={busy} label={busy ? 'Saving…' : 'Continue'} onPress={() => void registerAndCall()} />
          <SecondaryButton label="Not Now" onPress={() => setNumberPromptVisible(false)} />
        </View>
      </View>
    </Modal>
  </>;
}

function CallIcon({ name }: { name: 'interpret' | 'phone' | 'video' }) {
  if (name === 'phone') return <Svg height={25} viewBox="0 0 24 24" width={25}><Path d="M6.7 3.1 9 2.5c.7-.2 1.4.2 1.7.9l1 2.8c.2.6 0 1.2-.5 1.6L9.7 9a14.5 14.5 0 0 0 5.3 5.3l1.2-1.5c.4-.5 1-.7 1.6-.5l2.8 1c.7.3 1.1 1 1 1.7l-.6 2.3a3 3 0 0 1-3 2.3A15.4 15.4 0 0 1 4.4 6a3 3 0 0 1 2.3-2.9Z" fill="none" stroke={BLUE} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  if (name === 'interpret') return <View style={styles.interpretIcon}><Text style={styles.interpretIconText}>S</Text></View>;
  return <Svg height={25} viewBox="0 0 24 24" width={25}><Rect fill="none" height={13} rx={3} stroke={BLUE} strokeWidth={1.8} width={13} x={2.5} y={5.5} /><Path d="m15.5 9 4-2.2c.8-.4 1.7.1 1.7 1v8.4c0 .9-.9 1.4-1.7 1l-4-2.2V9Z" fill="none" stroke={BLUE} strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
}

function Header({ onBack }: { onBack: () => void }) { return <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Calling</Text></Pressable>; }
function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.detailRow}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }
function PrimaryButton({ disabled = false, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.primary, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.secondary}><Text style={styles.secondaryText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  listScreen: { minHeight: 560 }, back: { alignSelf: 'flex-start', marginBottom: 10, paddingVertical: 5 }, backText: { color: BLUE, fontSize: 16, fontWeight: '600' }, title: { color: '#102A56', fontSize: 27, fontWeight: '800' }, body: { color: '#5D7398', fontSize: 15, lineHeight: 22, marginTop: 10 },
  statusCard: { backgroundColor: 'rgba(255,255,255,0.74)', borderRadius: 18, marginTop: 20, padding: 16 }, statusLabel: { color: '#667085', fontSize: 13 }, statusValue: { color: '#101828', fontSize: 17, fontWeight: '700', marginTop: 4 }, error: { color: '#B42318', fontSize: 13, marginTop: 10 },
  primary: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 18, marginTop: 16, paddingVertical: 15 }, primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, secondary: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.52)', borderRadius: 18, marginTop: 10, paddingVertical: 14 }, secondaryText: { color: '#174EA6', fontSize: 15, fontWeight: '600' }, disabled: { opacity: 0.5 },
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, reloadButton: { backgroundColor: '#EAF2FF', borderRadius: 15, paddingHorizontal: 15, paddingVertical: 9 }, reloadText: { color: BLUE, fontWeight: '700' }, search: { backgroundColor: '#F5F8FE', borderColor: '#DCE8FA', borderRadius: 16, borderWidth: 1, color: '#102A56', fontSize: 15, marginTop: 15, paddingHorizontal: 15, paddingVertical: 12 },
  contactList: { paddingBottom: 28, paddingTop: 8 }, contactRow: { alignItems: 'center', flexDirection: 'row', minHeight: 68 }, avatar: { alignItems: 'center', backgroundColor: '#EAF2FF', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, avatarText: { color: BLUE, fontSize: 17, fontWeight: '800' }, contactCopy: { flex: 1, marginLeft: 11 }, contactName: { color: '#102A56', fontSize: 16, fontWeight: '700' }, contactMeta: { color: '#6E83A7', fontSize: 11, marginTop: 3 }, chevron: { color: BLUE, fontSize: 28 }, empty: { color: '#6E83A7', fontSize: 14, lineHeight: 21, paddingHorizontal: 15, paddingVertical: 28, textAlign: 'center' }, pressed: { opacity: 0.62 },
  details: { paddingBottom: 34 }, detailAvatar: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#EAF2FF', borderColor: '#CFE0FF', borderRadius: 40, borderWidth: 1, height: 80, justifyContent: 'center', width: 80 }, detailAvatarText: { color: BLUE, fontSize: 34, fontWeight: '800' }, detailName: { color: '#102A56', fontSize: 25, fontWeight: '800', marginTop: 9, textAlign: 'center' }, userStatus: { color: '#6E83A7', fontSize: 13, marginTop: 4, textAlign: 'center' }, callGrid: { flexDirection: 'row', gap: 10, marginTop: 17 }, callButton: { alignItems: 'center', backgroundColor: '#F4F7FD', borderColor: '#DCE8FA', borderRadius: 18, borderWidth: 1, flex: 1, minHeight: 88, justifyContent: 'center', padding: 8 }, callLabel: { color: '#174EA6', fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' }, interpretButton: { backgroundColor: BLUE }, interpretLabel: { color: '#FFFFFF' }, interpretIcon: { alignItems: 'center', borderColor: '#FFFFFF', borderRadius: 13, borderWidth: 1.5, height: 26, justifyContent: 'center', width: 26 }, interpretIconText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' }, comingSoon: { color: '#6E83A7', fontSize: 9, marginTop: 2 }, sectionTitle: { color: '#344F78', fontSize: 15, fontWeight: '800', marginBottom: 7, marginTop: 20 }, detailCard: { backgroundColor: '#F7F9FD', borderColor: '#E0E8F4', borderRadius: 18, borderWidth: 1, paddingHorizontal: 15 }, detailRow: { paddingVertical: 11 }, fieldLabel: { color: '#6E83A7', fontSize: 11, fontWeight: '700' }, detailValue: { color: '#102A56', fontSize: 15, lineHeight: 21, marginTop: 3 }, input: { backgroundColor: '#FFFFFF', borderColor: '#DDE5F1', borderRadius: 15, borderWidth: 1, color: '#101828', fontSize: 15, marginTop: 9, paddingHorizontal: 14, paddingVertical: 12 },
  numberBackdrop: { alignItems: 'center', backgroundColor: 'rgba(8,18,38,0.22)', flex: 1, justifyContent: 'center', padding: 24 }, numberCard: { backgroundColor: 'rgba(248,251,255,0.92)', borderRadius: 26, maxWidth: 420, padding: 22, width: '100%' }, numberTitle: { color: '#101828', fontSize: 22, fontWeight: '800', textAlign: 'center' }, numberBody: { color: '#667085', fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: 'center' },
});
