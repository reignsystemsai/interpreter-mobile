import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Contacts from 'expo-contacts';

export type ContactValue = { countryCode?: string; label: string; value: string };
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
  deleteAllContacts: () => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  requestAndImport: () => Promise<void>;
  updateContact: (id: string, update: ContactUpdate) => Promise<InterpreterContact>;
};

const ContactsContext = createContext<ContactsContextValue | null>(null);

function toInterpreterContact(contact: Contacts.Contact, index: number): InterpreterContact {
  const now = new Date().toISOString();
  const localId = `device-${index}-${contact.name || contact.phoneNumbers?.[0]?.number || contact.emails?.[0]?.email || 'contact'}`;
  return {
    id: localId,
    deviceContactId: localId,
    displayName: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unnamed contact',
    givenName: contact.firstName ?? null,
    familyName: contact.lastName ?? null,
    company: contact.company ?? null,
    phoneNumbers: (contact.phoneNumbers ?? []).map((phone) => ({ countryCode: phone.countryCode ?? undefined, label: phone.label || 'phone', value: phone.number || phone.digits || '' })).filter((phone) => phone.value),
    emailAddresses: (contact.emails ?? []).map((email) => ({ label: email.label || 'email', value: email.email || '' })).filter((email) => email.value),
    preferredLanguage: 'English',
    isFavorite: false,
    lastCalledAt: null,
    interpreterUserId: null,
    isInterpreterUser: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function ContactsProvider({ children }: PropsWithChildren) {
  const [contacts, setContacts] = useState<InterpreterContact[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [permission, setPermission] = useState<ContactsContextValue['permission']>('checking');

  const loadDeviceContacts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.ID, Contacts.Fields.Name, Contacts.Fields.FirstName, Contacts.Fields.LastName, Contacts.Fields.Company, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
        pageSize: 0,
        sort: Contacts.SortTypes.FirstName,
      });
      setContacts(result.data.map(toInterpreterContact));
    } catch {
      setError('Contacts could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const current = await Contacts.getPermissionsAsync();
    if (current.status !== 'granted') return;
    setPermission('granted');
    await loadDeviceContacts();
  }, [loadDeviceContacts]);

  useEffect(() => {
    let active = true;
    void Contacts.getPermissionsAsync().then((result) => {
      if (!active) return;
      const next = result.status === 'granted' ? 'granted' : result.canAskAgain ? 'undetermined' : 'blocked';
      setPermission(next);
      if (result.status === 'granted') void loadDeviceContacts();
    }).catch(() => active && setPermission('undetermined'));
    return () => { active = false; };
  }, [loadDeviceContacts]);

  const value = useMemo<ContactsContextValue>(() => ({
    contacts,
    error,
    loading,
    permission,
    async deleteAllContacts() { setContacts([]); },
    async deleteContact(id) { setContacts((current) => current.filter((contact) => contact.id !== id)); },
    refresh,
    async requestAndImport() {
      const current = await Contacts.getPermissionsAsync();
      const result = current.status === 'granted' ? current : await Contacts.requestPermissionsAsync();
      const next = result.status === 'granted' ? 'granted' : result.canAskAgain ? 'denied' : 'blocked';
      setPermission(next);
      if (next === 'blocked') throw new Error('Open Android Settings to allow contact access, then try again.');
      if (next !== 'granted') throw new Error('Contact access was not allowed.');
      await loadDeviceContacts();
    },
    async updateContact(id, update) {
      let updated: InterpreterContact | undefined;
      setContacts((current) => current.map((contact) => {
        if (contact.id !== id) return contact;
        updated = { ...contact, ...update, updatedAt: new Date().toISOString() };
        return updated;
      }));
      if (!updated) throw new Error('Contact was not found.');
      return updated;
    },
  }), [contacts, error, loading, loadDeviceContacts, permission, refresh]);

  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>;
}

export function useContacts() {
  const value = useContext(ContactsContext);
  if (!value) throw new Error('useContacts must be used inside ContactsProvider.');
  return value;
}
