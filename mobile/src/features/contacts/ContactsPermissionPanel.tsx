import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../account/AuthProvider';
import { type InterpreterContact, useContacts } from './ContactsProvider';
import { useCalling } from '../calling/CallProvider';
import type { CallType } from '../calling/types';

const LANGUAGES = ['English', 'Spanish', 'Brazilian Portuguese', 'French', 'German', 'Italian', 'Dutch', 'Russian', 'Polish', 'Romanian', 'Turkish', 'Arabic', 'Hebrew', 'Hindi', 'Japanese', 'Korean', 'Mandarin Chinese', 'Cantonese', 'Vietnamese', 'Thai'];
type Filter = 'all' | 'favorites' | 'recent';

export function ContactsPermissionPanel({ onBack, onRequireSignIn }: { onBack: () => void; onRequireSignIn: () => void }) {
  const { isGuest, user } = useAuth();
  const { contacts, deleteAllContacts, deleteContact, error, loading, permission, requestAndImport, requestPermission, stopSyncing, syncEnabled, syncing, updateContact } = useContacts();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = contacts.find((contact) => contact.id === selectedId) ?? null;

  const visibleContacts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (filter === 'favorites' && !contact.isFavorite) return false;
      if (filter === 'recent' && !contact.lastCalledAt) return false;
      if (!normalized) return true;
      return [contact.displayName, contact.company, contact.phoneNumbers.map((item) => item.value).join(' '), contact.emailAddresses.map((item) => item.value).join(' ')]
        .join(' ').toLowerCase().includes(normalized);
    }).sort((a, b) => filter === 'recent'
      ? new Date(b.lastCalledAt ?? 0).getTime() - new Date(a.lastCalledAt ?? 0).getTime()
      : a.displayName.localeCompare(b.displayName));
  }, [contacts, filter, query]);

  if (!user || isGuest) return (
    <View>
      <Header onBack={onBack} />
      <Text style={styles.title}>My Contacts</Text>
      <Text style={styles.body}>Contact access and cloud synchronization are separate. You may allow device access now, but signing in is required before Interpreter reads and securely synchronizes contact details.</Text>
      <View style={styles.statusCard}><Text style={styles.statusLabel}>Device contact access</Text><Text style={styles.statusValue}>{permissionLabel(permission)}</Text></View>
      {permission === 'blocked'
        ? <PrimaryButton label="Open Android Settings" onPress={() => void Linking.openSettings()} />
        : permission !== 'granted'
          ? <PrimaryButton label="Allow Device Contacts" onPress={() => void requestPermission().catch(() => Alert.alert('Unable to request access', 'Open Android Settings and try again.'))} />
          : null}
      <SecondaryButton label="Sign In to Sync Across Devices" onPress={onRequireSignIn} />
    </View>
  );

  if (selected) return <ContactDetails contact={selected} onBack={() => setSelectedId(null)} onDelete={async () => { await deleteContact(selected.id); setSelectedId(null); }} onRequireSignIn={onRequireSignIn} onUpdate={(update) => updateContact(selected.id, update)} />;

  if (permission !== 'granted' && !contacts.length) return (
    <View>
      <Header onBack={onBack} />
      <Text style={styles.title}>My Contacts</Text>
      <Text style={styles.body}>Interpreter imports only names, phone numbers, email addresses, and company names after you approve access. Contacts are encrypted in transit and stored only in your authenticated account.</Text>
      <View style={styles.statusCard}><Text style={styles.statusLabel}>Contacts permission</Text><Text style={styles.statusValue}>{permissionLabel(permission)}</Text></View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {permission === 'blocked'
        ? <PrimaryButton label="Open Android Settings" onPress={() => void Linking.openSettings()} />
        : <PrimaryButton disabled={syncing || permission === 'checking'} label={syncing ? 'Importing…' : 'Allow Contacts & Import'} onPress={() => void requestAndImport().catch((nextError) => Alert.alert('Unable to import', nextError instanceof Error ? nextError.message : 'Contacts could not be imported right now. Please try again.'))} />}
      <SecondaryButton label="Not Now" onPress={onBack} />
    </View>
  );

  return (
    <View style={styles.listScreen}>
      <Header onBack={onBack} />
      <View style={styles.titleRow}><View><Text style={styles.title}>My Contacts</Text><Text style={styles.syncText}>{syncing ? 'Synchronizing…' : syncEnabled ? 'Device sync on' : 'Cloud contacts'}</Text></View><Pressable accessibilityLabel="Import device contacts" onPress={() => void requestAndImport().catch((nextError) => Alert.alert('Unable to sync', nextError instanceof Error ? nextError.message : 'Contacts could not be imported right now. Please try again.'))} style={styles.syncButton}><Text style={styles.syncButtonText}>Sync</Text></Pressable></View>
      <TextInput autoCapitalize="none" onChangeText={setQuery} placeholder="Search contacts" placeholderTextColor="#98A2B3" style={styles.search} value={query} />
      <View style={styles.filters}>{(['all', 'favorites', 'recent'] as Filter[]).map((item) => <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterActive]}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item === 'all' ? 'All' : item === 'favorites' ? 'Favorites' : 'Recently Called'}</Text></Pressable>)}</View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.contactList} showsVerticalScrollIndicator={false}>
        {loading ? <Text style={styles.empty}>Loading contacts…</Text> : visibleContacts.map((contact) => (
          <Pressable key={contact.id} onPress={() => setSelectedId(contact.id)} style={({ pressed }) => [styles.contactRow, pressed && styles.pressed]}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.contactCopy}><Text numberOfLines={1} style={styles.contactName}>{contact.displayName}</Text><Text numberOfLines={1} style={styles.contactMeta}>{contact.isInterpreterUser ? 'Interpreter user' : contact.phoneNumbers[0]?.value || contact.emailAddresses[0]?.value || 'Contact'} · {contact.preferredLanguage}</Text></View>
            <Pressable accessibilityLabel={contact.isFavorite ? 'Remove favorite' : 'Add favorite'} onPress={() => void updateContact(contact.id, { isFavorite: !contact.isFavorite })} hitSlop={8}><Text style={[styles.star, contact.isFavorite && styles.starActive]}>{contact.isFavorite ? '★' : '☆'}</Text></Pressable>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
        {!loading && !visibleContacts.length ? <Text style={styles.empty}>{filter === 'recent' ? 'No completed calls yet. Recently called contacts will appear when calling is enabled.' : 'No contacts found.'}</Text> : null}
        <View style={styles.manageCard}>
          <SecondaryButton label={syncEnabled ? 'Stop Syncing' : 'Enable Device Sync'} onPress={() => void (syncEnabled ? stopSyncing() : requestAndImport()).catch((nextError) => Alert.alert('Unable to update sync', nextError instanceof Error ? nextError.message : 'Contacts could not be imported right now. Please try again.'))} />
          <Pressable onPress={() => Alert.alert('Delete imported contacts?', 'This removes only Interpreter’s cloud copies. Contacts on your phone will not be changed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void deleteAllContacts().catch((nextError) => Alert.alert('Unable to delete contacts', nextError instanceof Error ? nextError.message : 'Contacts could not be deleted right now. Please try again.')) }])} style={styles.danger}><Text style={styles.dangerText}>Delete Imported Contacts</Text></Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function permissionLabel(permission: ReturnType<typeof useContacts>['permission']) {
  if (permission === 'checking') return 'Checking…';
  if (permission === 'granted') return 'Allowed';
  if (permission === 'blocked') return 'Blocked in Android Settings';
  if (permission === 'denied') return 'Not allowed';
  return 'Not requested';
}

function ContactDetails({ contact, onBack, onDelete, onRequireSignIn, onUpdate }: { contact: InterpreterContact; onBack: () => void; onDelete: () => Promise<void>; onRequireSignIn: () => void; onUpdate: (update: Parameters<ReturnType<typeof useContacts>['updateContact']>[1]) => Promise<InterpreterContact> }) {
  const { isGuest } = useAuth();
  const { presenceFor, startCall } = useCalling();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(contact.displayName);
  const [phone, setPhone] = useState(contact.phoneNumbers[0]?.value ?? '');
  const [email, setEmail] = useState(contact.emailAddresses[0]?.value ?? '');
  const [language, setLanguage] = useState(contact.preferredLanguage);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(contact.displayName); setPhone(contact.phoneNumbers[0]?.value ?? ''); setEmail(contact.emailAddresses[0]?.value ?? ''); setLanguage(contact.preferredLanguage); }, [contact]);

  const save = async () => {
    setBusy(true);
    try {
      await onUpdate({
        displayName: name,
        phoneNumbers: phone ? [{ label: contact.phoneNumbers[0]?.label || 'phone', value: phone }, ...contact.phoneNumbers.slice(1)] : contact.phoneNumbers.slice(1),
        emailAddresses: email ? [{ label: contact.emailAddresses[0]?.label || 'email', value: email }, ...contact.emailAddresses.slice(1)] : contact.emailAddresses.slice(1),
        preferredLanguage: language,
      });
      setEditing(false);
    } catch (nextError) { Alert.alert('Unable to save', nextError instanceof Error ? nextError.message : 'Try again.'); }
    finally { setBusy(false); }
  };
  const beginCall = async (type: CallType) => {
    if (type === 'business_video' && isGuest) { onRequireSignIn(); return; }
    try { await startCall(contact.id, type); }
    catch (nextError) { Alert.alert('Unable to call', nextError instanceof Error ? nextError.message : 'Try again.'); }
  };
  const invite = async () => {
    const text = encodeURIComponent('Join me on Interpreter.ai for language-friendly voice and video conversations.');
    const phoneValue = contact.phoneNumbers[0]?.value;
    const emailValue = contact.emailAddresses[0]?.value;
    const url = phoneValue ? `sms:${encodeURIComponent(phoneValue)}?body=${text}` : emailValue ? `mailto:${encodeURIComponent(emailValue)}?subject=Join%20Interpreter.ai&body=${text}` : 'https://interpreter.ai';
    await Linking.openURL(url);
  };

  return (
    <ScrollView contentContainerStyle={styles.details} showsVerticalScrollIndicator={false}>
      <Pressable onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Contacts</Text></Pressable>
      <View style={styles.detailAvatar}><Text style={styles.detailAvatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text></View>
      {editing ? <TextInput onChangeText={setName} placeholder="Contact name" style={styles.input} value={name} /> : <Text style={styles.detailName}>{contact.displayName}</Text>}
      <Text style={styles.userStatus}>{contact.isInterpreterUser ? `Uses Interpreter · ${presenceFor(contact.id).replace('_', ' ')}` : 'Not yet on Interpreter'}</Text>
      <View style={styles.callGrid}>{([{ label: 'Voice Call', type: 'voice' }, { label: 'Video Call', type: 'video' }, { label: 'Business Video Call', type: 'business_video' }] as const).map((item) => <Pressable disabled={!contact.isInterpreterUser} key={item.type} onPress={() => void beginCall(item.type)} style={[styles.callButton, !contact.isInterpreterUser && styles.disabled]}><Text style={styles.callIcon}>{item.type === 'voice' ? '☎' : '▣'}</Text><Text style={styles.callLabel}>{item.label}</Text></Pressable>)}</View>
      {!contact.isInterpreterUser ? <PrimaryButton label="Invite to Interpreter" onPress={() => void invite().catch(() => Alert.alert('Unable to open invite'))} /> : null}
      <Text style={styles.sectionTitle}>Contact details</Text>
      {editing ? <><TextInput keyboardType="phone-pad" onChangeText={setPhone} placeholder="Phone number" style={styles.input} value={phone} /><TextInput autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} placeholder="Email address" style={styles.input} value={email} /><Text style={styles.fieldLabel}>Preferred language</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.languages}>{LANGUAGES.map((item) => <Pressable key={item} onPress={() => setLanguage(item)} style={[styles.languageChip, language === item && styles.languageChipActive]}><Text style={[styles.languageText, language === item && styles.languageTextActive]}>{item}</Text></Pressable>)}</ScrollView></> : <View style={styles.detailCard}><Detail label="Phone" value={contact.phoneNumbers.map((item) => item.value).join('\n') || 'Not provided'} /><Detail label="Email" value={contact.emailAddresses.map((item) => item.value).join('\n') || 'Not provided'} /><Detail label="Company" value={contact.company || 'Not provided'} /><Detail label="Preferred language" value={contact.preferredLanguage} /></View>}
      {editing ? <><PrimaryButton disabled={busy} label={busy ? 'Saving…' : 'Save Contact'} onPress={() => void save()} /><SecondaryButton label="Cancel" onPress={() => setEditing(false)} /></> : <SecondaryButton label="Edit Contact" onPress={() => setEditing(true)} />}
      <Pressable onPress={() => Alert.alert('Delete contact?', `Delete ${contact.displayName} from every signed-in device?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void onDelete().catch(() => Alert.alert('Unable to delete contact')) }])} style={styles.danger}><Text style={styles.dangerText}>Delete Contact</Text></Pressable>
    </ScrollView>
  );
}

function Header({ onBack }: { onBack: () => void }) { return <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Calling</Text></Pressable>; }
function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.detailRow}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }
function PrimaryButton({ disabled = false, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.primary, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.secondary}><Text style={styles.secondaryText}>{label}</Text></Pressable>; }

const BLUE = '#075BFF';
const styles = StyleSheet.create({
  listScreen: { minHeight: 560 }, back: { alignSelf: 'flex-start', marginBottom: 10, paddingVertical: 5 }, backText: { color: BLUE, fontSize: 16, fontWeight: '600' }, title: { color: '#101828', fontSize: 27, fontWeight: '800' }, body: { color: '#667085', fontSize: 15, lineHeight: 22, marginTop: 10 },
  statusCard: { backgroundColor: 'rgba(255,255,255,0.74)', borderColor: 'rgba(117,151,213,0.22)', borderRadius: 18, borderWidth: 1, marginTop: 20, padding: 16 }, statusLabel: { color: '#667085', fontSize: 13 }, statusValue: { color: '#101828', fontSize: 17, fontWeight: '700', marginTop: 4 }, error: { color: '#B42318', fontSize: 13, marginTop: 10 },
  primary: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 18, marginTop: 16, paddingVertical: 15 }, primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, secondary: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.8)', borderColor: '#D9E3F2', borderRadius: 18, borderWidth: 1, marginTop: 10, paddingVertical: 14 }, secondaryText: { color: '#174EA6', fontSize: 15, fontWeight: '600' }, disabled: { opacity: 0.5 },
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, syncText: { color: '#667085', fontSize: 12, marginTop: 2 }, syncButton: { backgroundColor: '#EAF1FF', borderRadius: 15, paddingHorizontal: 15, paddingVertical: 9 }, syncButtonText: { color: BLUE, fontWeight: '700' }, search: { backgroundColor: 'rgba(255,255,255,0.86)', borderColor: '#DDE5F1', borderRadius: 16, borderWidth: 1, color: '#101828', fontSize: 15, marginTop: 15, paddingHorizontal: 15, paddingVertical: 12 }, filters: { flexDirection: 'row', gap: 6, marginTop: 10 }, filter: { borderRadius: 15, paddingHorizontal: 11, paddingVertical: 8 }, filterActive: { backgroundColor: BLUE }, filterText: { color: '#667085', fontSize: 12, fontWeight: '600' }, filterTextActive: { color: '#FFFFFF' },
  contactList: { paddingBottom: 28, paddingTop: 8 }, contactRow: { alignItems: 'center', borderBottomColor: '#E5EBF3', borderBottomWidth: 1, flexDirection: 'row', minHeight: 68 }, avatar: { alignItems: 'center', backgroundColor: '#EAF1FF', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, avatarText: { color: BLUE, fontSize: 17, fontWeight: '800' }, contactCopy: { flex: 1, marginLeft: 11 }, contactName: { color: '#101828', fontSize: 16, fontWeight: '700' }, contactMeta: { color: '#667085', fontSize: 11, marginTop: 3 }, star: { color: '#98A2B3', fontSize: 24, padding: 5 }, starActive: { color: '#FFB000' }, chevron: { color: '#7E8BA3', fontSize: 28 }, empty: { color: '#667085', fontSize: 14, lineHeight: 21, paddingHorizontal: 15, paddingVertical: 28, textAlign: 'center' }, pressed: { opacity: 0.62 }, manageCard: { borderTopColor: '#DDE5F1', borderTopWidth: 1, marginTop: 12, paddingTop: 4 }, danger: { alignItems: 'center', marginTop: 9, paddingVertical: 13 }, dangerText: { color: '#D92D20', fontSize: 15, fontWeight: '600' },
  details: { paddingBottom: 34 }, detailAvatar: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#EAF1FF', borderRadius: 40, height: 80, justifyContent: 'center', width: 80 }, detailAvatarText: { color: BLUE, fontSize: 34, fontWeight: '800' }, detailName: { color: '#101828', fontSize: 25, fontWeight: '800', marginTop: 9, textAlign: 'center' }, userStatus: { color: '#667085', fontSize: 13, marginTop: 4, textAlign: 'center' }, callGrid: { flexDirection: 'row', gap: 7, marginTop: 17 }, callButton: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.8)', borderColor: '#DDE5F1', borderRadius: 16, borderWidth: 1, flex: 1, minHeight: 78, justifyContent: 'center', padding: 6 }, callIcon: { color: BLUE, fontSize: 22 }, callLabel: { color: '#344054', fontSize: 10, fontWeight: '600', marginTop: 5, textAlign: 'center' }, sectionTitle: { color: '#344054', fontSize: 15, fontWeight: '800', marginBottom: 7, marginTop: 20 }, detailCard: { backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 18, paddingHorizontal: 15 }, detailRow: { borderBottomColor: '#E8EDF4', borderBottomWidth: 1, paddingVertical: 11 }, fieldLabel: { color: '#667085', fontSize: 11, fontWeight: '700' }, detailValue: { color: '#101828', fontSize: 15, lineHeight: 21, marginTop: 3 }, input: { backgroundColor: '#FFFFFF', borderColor: '#DDE5F1', borderRadius: 15, borderWidth: 1, color: '#101828', fontSize: 15, marginTop: 9, paddingHorizontal: 14, paddingVertical: 12 }, languages: { marginTop: 8 }, languageChip: { backgroundColor: '#FFFFFF', borderColor: '#DDE5F1', borderRadius: 15, borderWidth: 1, marginRight: 7, paddingHorizontal: 11, paddingVertical: 8 }, languageChipActive: { backgroundColor: BLUE, borderColor: BLUE }, languageText: { color: '#475467', fontSize: 12 }, languageTextActive: { color: '#FFFFFF' },
});
