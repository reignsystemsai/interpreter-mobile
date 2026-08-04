import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Contacts from 'expo-contacts';
import * as SecureStore from 'expo-secure-store';

import { ApiError, authenticatedRequest } from '../../services/api';
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
  permission: 'checking' | 'undetermined' | 'granted' | 'denied' | 'blocked';
  syncEnabled: boolean;
  syncing: boolean;
  deleteAllContacts: () => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  requestPermission: () => Promise<'granted' | 'denied' | 'blocked'>;
  requestAndImport: () => Promise<void>;
  stopSyncing: () => Promise<void>;
  updateContact: (id: string, update: ContactUpdate) => Promise<InterpreterContact>;
};

const SYNC_KEY = 'interpreter.contacts.sync-enabled';
const ContactsContext = createContext<ContactsContextValue | null>(null);

type ContactOperation = 'delete' | 'import' | 'load' | 'update';

function contactErrorMessage(operation: ContactOperation, error: unknown) {
  if (error instanceof ApiError && [401, 403].includes(error.status)) {
    return 'Sign in to sync contacts across your devices.';
  }
  if (error instanceof TypeError) {
    return 'We could not reach Interpreter. Check your connection and try again.';
  }
  if (operation === 'delete') return 'Contacts could not be deleted right now. Please try again.';
  if (operation === 'load') return 'Contacts could not be loaded right now. Please try again.';
  if (operation === 'update') return 'This contact could not be updated right now. Please try again.';
  return 'Contacts could not be imported right now. Please try again.';
}

function logContactFailure(operation: ContactOperation, error: unknown) {
  if (!__DEV__) return;
  console.warn('[Contacts]', { operation, status: error instanceof ApiError ? error.status : 'client' });
}

export function ContactsProvider({ children }: PropsWithChildren) {
  const { isGuest, user } = useAuth();
  const [contacts, setContacts] = useState<InterpreterContact[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [permission, setPermission] = useState<ContactsContextValue['permission']>('checking');
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || isGuest) { setContacts([]); return; }
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
    } catch (nextError) { logContactFailure('load', nextError); setError(contactErrorMessage('load', nextError)); }
    finally { setLoading(false); }
  }, [isGuest, user]);

  const importDeviceContacts = useCallback(async () => {
    if (!user || isGuest) throw new Error('Sign in to sync contacts across your devices.');
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
      logContactFailure('import', nextError);
      const message = contactErrorMessage('import', nextError);
      setError(message);
      throw new Error(message);
    } finally { setSyncing(false); }
  }, [isGuest, refresh, user]);

  const requestPermission = useCallback(async () => {
    const current = await Contacts.getPermissionsAsync();
    const result = current.status === 'granted' ? current : await Contacts.requestPermissionsAsync();
    const nextPermission = result.status === 'granted' ? 'granted' : result.canAskAgain ? 'denied' : 'blocked';
    setPermission(nextPermission);
    return nextPermission;
  }, []);

  useEffect(() => {
    let active = true;
    if (!user || isGuest) {
      setContacts([]); setPermission('undetermined'); setSyncEnabled(false);
      void Contacts.getPermissionsAsync().then((result) => {
        if (!active) return;
        setPermission(result.status === 'granted' ? 'granted' : result.canAskAgain ? 'undetermined' : 'blocked');
      }).catch(() => active && setPermission('undetermined'));
      return () => { active = false; };
    }
    void Promise.all([Contacts.getPermissionsAsync(), SecureStore.getItemAsync(SYNC_KEY)])
      .then(async ([permissionResult, stored]) => {
        if (!active) return;
        const granted = permissionResult.status === 'granted';
        setPermission(granted ? 'granted' : permissionResult.canAskAgain ? 'undetermined' : 'blocked');
        setSyncEnabled(stored === 'true');
        await refresh();
        if (granted && stored === 'true' && active) await importDeviceContacts();
      })
      .catch(() => active && setPermission('undetermined'));
    return () => { active = false; };
  }, [importDeviceContacts, isGuest, refresh, user]);

  useEffect(() => {
    if (!user || isGuest || permission !== 'granted' || !syncEnabled) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const subscription = Contacts.addContactsChangeListener(() => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => void importDeviceContacts().catch(() => undefined), 800);
    });
    return () => { if (timeout) clearTimeout(timeout); subscription.remove(); };
  }, [importDeviceContacts, isGuest, permission, syncEnabled, user]);

  const value = useMemo<ContactsContextValue>(() => ({
    contacts, error, loading, permission, syncEnabled, syncing,
    async deleteAllContacts() {
      if (isGuest) throw new Error('Sign in to sync contacts across your devices.');
      try {
        await authenticatedRequest('/api/v1/contacts', { method: 'DELETE' });
        await SecureStore.setItemAsync(SYNC_KEY, 'false');
        setSyncEnabled(false);
        setContacts([]);
        setError('');
      } catch (nextError) {
        logContactFailure('delete', nextError);
        throw new Error(contactErrorMessage('delete', nextError));
      }
    },
    async deleteContact(id) {
      try {
        await authenticatedRequest(`/api/v1/contacts/${id}`, { method: 'DELETE' });
        setContacts((current) => current.filter((contact) => contact.id !== id));
      } catch (nextError) {
        logContactFailure('delete', nextError);
        throw new Error(contactErrorMessage('delete', nextError));
      }
    },
    refresh,
    requestPermission,
    async requestAndImport() {
      const result = await requestPermission();
      if (result === 'blocked') throw new Error('Open Android Settings to allow contact access, then try again.');
      if (result !== 'granted') throw new Error('Contact access was not allowed. You can try again anytime.');
      if (!user || isGuest) throw new Error('Sign in to sync contacts across your devices.');
      await SecureStore.setItemAsync(SYNC_KEY, 'true');
      setSyncEnabled(true);
      await importDeviceContacts();
    },
    async stopSyncing() {
      await SecureStore.setItemAsync(SYNC_KEY, 'false');
      setSyncEnabled(false);
    },
    async updateContact(id, update) {
      try {
        const result = await authenticatedRequest<{ contact: InterpreterContact }>(`/api/v1/contacts/${id}`, {
          method: 'PATCH', body: JSON.stringify(update),
        });
        setContacts((current) => current.map((contact) => contact.id === id ? result.contact : contact));
        return result.contact;
      } catch (nextError) {
        logContactFailure('update', nextError);
        throw new Error(contactErrorMessage('update', nextError));
      }
    },
  }), [contacts, error, importDeviceContacts, isGuest, loading, permission, refresh, requestPermission, syncEnabled, syncing, user]);

  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>;
}

export function useContacts() {
  const value = useContext(ContactsContext);
  if (!value) throw new Error('useContacts must be used inside ContactsProvider.');
  return value;
}
