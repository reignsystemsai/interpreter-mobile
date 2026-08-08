import { useEffect, useMemo, useRef, useState } from 'react';
import * as Contacts from 'expo-contacts';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { type InterpreterContact, useContacts } from './ContactsProvider';

const APP_DOWNLOAD_URL = 'https://interpreter.ai/download';
const BLUE = '#075BFF';

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
      <ScrollView contentContainerStyle={styles.contactList} showsVerticalScrollIndicator={false}>
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

  return <>
    <ScrollView contentContainerStyle={styles.details} showsVerticalScrollIndicator={false}>
      <Pressable onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Contacts</Text></Pressable>
      <View style={styles.detailAvatar}><Text style={styles.detailAvatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text></View>
      <Text style={styles.detailName}>{contact.displayName}</Text>
      <Text style={styles.userStatus}>iPhone contact</Text>
      <PrimaryButton label="Invite to Interpreter" onPress={() => void invite().catch(() => Alert.alert('Unable to open invite'))} />
      <Text style={styles.sectionTitle}>Contact details</Text>
      <View style={styles.detailCard}>
        <Detail label="Phone" value={contact.phoneNumbers.map((item) => item.value).join('\n') || 'Not provided'} />
        <Detail label="Email" value={contact.emailAddresses.map((item) => item.value).join('\n') || 'Not provided'} />
        <Detail label="Company" value={contact.company || 'Not provided'} />
      </View>
      <SecondaryButton label="Edit in Contacts" onPress={() => void editNativeContact()} />
    </ScrollView>
  </>;
}

function Header({ onBack }: { onBack: () => void }) { return <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Close</Text></Pressable>; }
function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.detailRow}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }
function PrimaryButton({ disabled = false, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.primary, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.secondary}><Text style={styles.secondaryText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  listScreen: { minHeight: 560 }, back: { alignSelf: 'flex-start', marginBottom: 10, paddingVertical: 5 }, backText: { color: BLUE, fontSize: 16, fontWeight: '600' }, title: { color: '#101828', fontSize: 27, fontWeight: '800' }, body: { color: '#667085', fontSize: 15, lineHeight: 22, marginTop: 10 },
  statusCard: { backgroundColor: 'rgba(255,255,255,0.74)', borderRadius: 18, marginTop: 20, padding: 16 }, statusLabel: { color: '#667085', fontSize: 13 }, statusValue: { color: '#101828', fontSize: 17, fontWeight: '700', marginTop: 4 }, error: { color: '#B42318', fontSize: 13, marginTop: 10 },
  primary: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 18, marginTop: 16, paddingVertical: 15 }, primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, secondary: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.52)', borderRadius: 18, marginTop: 10, paddingVertical: 14 }, secondaryText: { color: '#174EA6', fontSize: 15, fontWeight: '600' }, disabled: { opacity: 0.5 },
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, reloadButton: { backgroundColor: '#EAF1FF', borderRadius: 15, paddingHorizontal: 15, paddingVertical: 9 }, reloadText: { color: BLUE, fontWeight: '700' }, search: { backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 16, color: '#101828', fontSize: 15, marginTop: 15, paddingHorizontal: 15, paddingVertical: 12 },
  contactList: { paddingBottom: 28, paddingTop: 8 }, contactRow: { alignItems: 'center', flexDirection: 'row', minHeight: 68 }, avatar: { alignItems: 'center', backgroundColor: '#EAF1FF', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, avatarText: { color: BLUE, fontSize: 17, fontWeight: '800' }, contactCopy: { flex: 1, marginLeft: 11 }, contactName: { color: '#101828', fontSize: 16, fontWeight: '700' }, contactMeta: { color: '#667085', fontSize: 11, marginTop: 3 }, chevron: { color: BLUE, fontSize: 28 }, empty: { color: '#667085', fontSize: 14, lineHeight: 21, paddingHorizontal: 15, paddingVertical: 28, textAlign: 'center' }, pressed: { opacity: 0.62 },
  details: { paddingBottom: 34 }, detailAvatar: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#EAF1FF', borderRadius: 40, height: 80, justifyContent: 'center', width: 80 }, detailAvatarText: { color: BLUE, fontSize: 34, fontWeight: '800' }, detailName: { color: '#101828', fontSize: 25, fontWeight: '800', marginTop: 9, textAlign: 'center' }, userStatus: { color: '#667085', fontSize: 13, marginTop: 4, textAlign: 'center' }, sectionTitle: { color: '#344054', fontSize: 15, fontWeight: '800', marginBottom: 7, marginTop: 20 }, detailCard: { backgroundColor: 'rgba(255,255,255,0.52)', borderRadius: 18, paddingHorizontal: 15 }, detailRow: { paddingVertical: 11 }, fieldLabel: { color: '#667085', fontSize: 11, fontWeight: '700' }, detailValue: { color: '#101828', fontSize: 15, lineHeight: 21, marginTop: 3 },
});
