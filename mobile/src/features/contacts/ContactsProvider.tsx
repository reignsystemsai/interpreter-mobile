import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Contacts from 'expo-contacts';
import * as SecureStore from 'expo-secure-store';

import { authenticatedRequest } from '../../services/api';
import { useAuth } from '../account/AuthProvider';

export type ContactValue = { label: string; value: string };
export type InterpreterContact = {
  id: string;
  deviceContactId: string | null;
  displayName: string;
  givenName: string | null;
  familyName: string | null;
  company: string | null;
  phoneNumbers: ContactValue[];
  emailAddresses: ContactValue[];
  preferredLanguage: string;
  isFavorite: boolean;
  lastCalledAt: string | null;
  interpreterUserId: string | null;
  isInterpreterUser: boolean;
  createdAt: string;
  updatedAt: string;
};

type ContactUpdate = Partial<Pick<InterpreterContact, 'displayName' | 'givenName' | 'familyName' | 'company' | 'phoneNumbers' | 'emailAddresses' | 'preferredLanguage' | 'isFavorite' | 'lastCalledAt'>>;
type ContactsContextValue = {
  contacts: InterpreterContact[];
  error: string;
  loading: boolean;
  permission: 'checking' | 'undetermined' | 'granted' | 'denied';
  syncEnabled: boolean;
  syncing: boolean;
  deleteAllContacts: () => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  requestAndImport: () => Promise<void>;
  stopSyncing: () => Promise<void>;
  updateContact: (id: string, update: ContactUpdate) => Promise<InterpreterContact>;
};

const SYNC_KEY = 'interpreter.contacts.sync-enabled';
const ContactsContext = createContext<ContactsContextValue | null>(null);

export function ContactsProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<InterpreterContact[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [permission, setPermission] = useState<ContactsContextValue['permission']>('checking');
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) { setContacts([]); return; }
    setLoading(true); setError('');
    try {
      const synchronized: InterpreterContact[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const result = await authenticatedRequest<{ contacts: InterpreterContact[]; hasMore: boolean }>(`/api/v1/contacts?limit=250&offset=${offset}`);
        synchronized.push(...result.contacts);
        hasMore = result.hasMore;
        offset += result.contacts.length;
        if (!result.contacts.length) break;
      }
      setContacts(synchronized);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Unable to load contacts.'); }
    finally { setLoading(false); }
  }, [user]);

  const importDeviceContacts = useCallback(async () => {
    if (!user) throw new Error('Sign in before importing contacts.');
    setSyncing(true); setError('');
    try {
      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.ID, Contacts.Fields.Name, Contacts.Fields.FirstName, Contacts.Fields.LastName, Contacts.Fields.Company, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
        pageSize: 0,
        sort: Contacts.SortTypes.FirstName,
      });
      const payload = result.data.map((contact) => ({
        deviceContactId: contact.id,
        displayName: contact.name,
        givenName: contact.firstName,
        familyName: contact.lastName,
        company: contact.company,
        phoneNumbers: (contact.phoneNumbers ?? []).map((phone) => ({ label: phone.label || 'phone', value: phone.number || phone.digits || '' })).filter((phone) => phone.value),
        emailAddresses: (contact.emails ?? []).map((email) => ({ label: email.label || 'email', value: email.email || '' })).filter((email) => email.value),
      }));
      for (let index = 0; index < payload.length; index += 200) {
        await authenticatedRequest('/api/v1/contacts/import', {
          method: 'POST',
          body: JSON.stringify({ contacts: payload.slice(index, index + 200) }),
        });
      }
      await refresh();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Unable to import contacts.';
      setError(message);
      throw nextError;
    } finally { setSyncing(false); }
  }, [refresh, user]);

  useEffect(() => {
    let active = true;
    if (!user) {
      setContacts([]); setPermission('undetermined'); setSyncEnabled(false);
      return () => { active = false; };
    }
    void Promise.all([Contacts.getPermissionsAsync(), SecureStore.getItemAsync(SYNC_KEY)])
      .then(async ([permissionResult, stored]) => {
        if (!active) return;
        const granted = permissionResult.status === 'granted';
        setPermission(granted ? 'granted' : permissionResult.status === 'denied' ? 'denied' : 'undetermined');
        setSyncEnabled(stored === 'true');
        await refresh();
        if (granted && stored === 'true' && active) await importDeviceContacts();
      })
      .catch(() => active && setPermission('undetermined'));
    return () => { active = false; };
  }, [importDeviceContacts, refresh, user]);

  useEffect(() => {
    if (!user || permission !== 'granted' || !syncEnabled) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const subscription = Contacts.addContactsChangeListener(() => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => void importDeviceContacts().catch(() => undefined), 800);
    });
    return () => { if (timeout) clearTimeout(timeout); subscription.remove(); };
  }, [importDeviceContacts, permission, syncEnabled, user]);

  const value = useMemo<ContactsContextValue>(() => ({
    contacts, error, loading, permission, syncEnabled, syncing,
    async deleteAllContacts() {
      await authenticatedRequest('/api/v1/contacts', { method: 'DELETE' });
      setContacts([]);
    },
    async deleteContact(id) {
      await authenticatedRequest(`/api/v1/contacts/${id}`, { method: 'DELETE' });
      setContacts((current) => current.filter((contact) => contact.id !== id));
    },
    refresh,
    async requestAndImport() {
      if (!user) throw new Error('Sign in before importing contacts.');
      const result = await Contacts.requestPermissionsAsync();
      const granted = result.status === 'granted';
      setPermission(granted ? 'granted' : 'denied');
      if (!granted) throw new Error('Contacts permission was not granted.');
      await SecureStore.setItemAsync(SYNC_KEY, 'true');
      setSyncEnabled(true);
      await importDeviceContacts();
    },
    async stopSyncing() {
      await SecureStore.setItemAsync(SYNC_KEY, 'false');
      setSyncEnabled(false);
    },
    async updateContact(id, update) {
      const result = await authenticatedRequest<{ contact: InterpreterContact }>(`/api/v1/contacts/${id}`, {
        method: 'PATCH', body: JSON.stringify(update),
      });
      setContacts((current) => current.map((contact) => contact.id === id ? result.contact : contact));
      return result.contact;
    },
  }), [contacts, error, importDeviceContacts, loading, permission, refresh, syncEnabled, syncing, user]);

  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>;
}

export function useContacts() {
  const value = useContext(ContactsContext);
  if (!value) throw new Error('useContacts must be used inside ContactsProvider.');
  return value;
}
