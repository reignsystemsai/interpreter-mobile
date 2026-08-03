import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { INTERPRETER_PLANS } from '../../config/plans';
import { authenticatedRequest } from '../../services/api';
import {
  availablePackages,
  configureMembership,
  membershipConfigured,
  openGooglePlaySubscriptions,
  purchaseMembership,
  restoreMembership,
} from '../../services/membership';
import { registerForAccountNotifications } from '../../services/notifications';
import { useAuth } from '../account/AuthProvider';
import type { MenuDestination } from './AppMenu';

type NotificationPreferences = {
  membership: boolean;
  product_updates: boolean;
  new_languages: boolean;
  service_alerts: boolean;
  marketing: boolean;
};

const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  membership: true,
  product_updates: true,
  new_languages: true,
  service_alerts: true,
  marketing: false,
};

export function DestinationSheet({ destination, onClose }: {
  destination: MenuDestination | null;
  onClose: () => void;
}) {
  const title = useMemo(() => ({
    account: 'My Account',
    membership: 'Interpreter Pro',
    billing: 'Billing & Payments',
    settings: 'Settings',
    languages: 'Languages',
    notifications: 'Notifications',
    help: 'Help & FAQ',
    support: 'Contact Support',
  }[destination ?? 'help']), [destination]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={Boolean(destination)}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <Text style={styles.title}>{title}</Text><View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {destination === 'account' ? <AccountContent /> : null}
          {destination === 'membership' ? <MembershipContent /> : null}
          {destination === 'billing' ? <BillingContent /> : null}
          {destination === 'settings' ? <SettingsContent /> : null}
          {destination === 'languages' ? <LanguagesContent /> : null}
          {destination === 'notifications' ? <NotificationsContent /> : null}
          {destination === 'help' ? <HelpContent /> : null}
          {destination === 'support' ? <SupportContent /> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function AccountContent() {
  const { configured, deleteAccount, legalApproved, sendPasswordReset, signIn, signUp, user } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');

  useEffect(() => {
    if (!user) return;
    void authenticatedRequest<{ profile?: { full_name?: string; phone?: string } }>('/api/v1/account/me')
      .then((account) => {
        setProfileName(account.profile?.full_name ?? '');
        setProfilePhone(account.profile?.phone ?? '');
      })
      .catch(() => undefined);
  }, [user]);

  if (!configured) return <ConfigurationNotice service="Account services" />;
  if (user) {
    const saveProfile = async () => {
      setBusy(true); setMessage('');
      try {
        await authenticatedRequest('/api/v1/account/me', {
          method: 'PATCH',
          body: JSON.stringify({ fullName: profileName, phone: profilePhone }),
        });
        setMessage('Account details saved.');
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save account.'); }
      finally { setBusy(false); }
    };
    return (
      <View>
        <Card><Label>Email</Label><Text style={styles.value}>{user.email}</Text></Card>
        <TextInput autoCapitalize="words" onChangeText={setProfileName} placeholder="Full name" style={styles.input} value={profileName} />
        <TextInput keyboardType="phone-pad" onChangeText={setProfilePhone} placeholder="Phone number (optional)" style={styles.input} value={profilePhone} />
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <PrimaryButton disabled={busy} label={busy ? 'Saving...' : 'Save Account'} onPress={() => void saveProfile()} />
        <SecondaryButton label="Reset Password by Email" onPress={() => void sendPasswordReset().then(() => Alert.alert('Email sent', 'Check your inbox for password reset instructions.')).catch((error) => Alert.alert('Unable to send email', error instanceof Error ? error.message : 'Try again.'))} />
        <Text style={styles.caption}>Your subscription must be canceled in Google Play before deleting your account.</Text>
        <Pressable onPress={() => Alert.alert('Delete account?', 'This permanently deletes the Interpreter account but does not cancel Google Play subscriptions.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => void deleteAccount() },
        ])} style={styles.dangerButton}><Text style={styles.dangerText}>Delete Account</Text></Pressable>
      </View>
    );
  }

  const submit = async () => {
    setBusy(true); setMessage('');
    try {
      if (mode === 'signin') await signIn(email, password);
      else {
        if (!accepted) throw new Error('Accept the Terms and Privacy Notice to create an account.');
        await signUp(email, password, fullName);
        setMessage('Check your email to confirm your account.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to continue.');
    } finally { setBusy(false); }
  };

  return (
    <View>
      <Text style={styles.intro}>{mode === 'signin' ? 'Sign in to manage your plan and preferences.' : 'Create your Interpreter account.'}</Text>
      {mode === 'signup' ? <TextInput autoCapitalize="words" onChangeText={setFullName} placeholder="Full name" style={styles.input} value={fullName} /> : null}
      <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder="Email" style={styles.input} value={email} />
      <TextInput autoCapitalize="none" autoComplete="password" onChangeText={setPassword} placeholder="Password" secureTextEntry style={styles.input} value={password} />
      {mode === 'signup' ? (
        <Pressable disabled={!legalApproved} onPress={() => setAccepted((current) => !current)} style={styles.acceptRow}>
          <Text style={styles.checkbox}>{accepted ? '✓' : '○'}</Text>
          <Text style={styles.acceptText}>{legalApproved ? 'I accept the Terms and Privacy Notice.' : 'Account creation is closed until legal review is complete.'}</Text>
        </Pressable>
      ) : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <PrimaryButton disabled={busy || (mode === 'signup' && !legalApproved)} label={busy ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'} onPress={() => void submit()} />
      <Pressable onPress={() => { setMode((current) => current === 'signin' ? 'signup' : 'signin'); setMessage(''); }} style={styles.linkButton}>
        <Text style={styles.link}>{mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}</Text>
      </Pressable>
    </View>
  );
}

function MembershipContent() {
  const { user } = useAuth();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user || !membershipConfigured()) return;
    void configureMembership(user.id).then(() => availablePackages()).then(setPackages).catch(() => setPackages([]));
  }, [user]);

  const purchase = async (productId?: string) => {
    if (!user) return Alert.alert('Sign in required', 'Sign in under My Account before subscribing.');
    const selected = packages.find((item) => item.product.identifier === productId);
    if (!selected) return Alert.alert('Not configured', 'This Google Play product is not available yet.');
    setBusy(true);
    try { await purchaseMembership(selected); Alert.alert('Membership updated', 'Your entitlement is now active.'); }
    catch (error) { Alert.alert('Purchase incomplete', error instanceof Error ? error.message : 'Unable to complete purchase.'); }
    finally { setBusy(false); }
  };

  return (
    <View>
      <Text style={styles.intro}>Paid plans renew monthly after a 7-day free trial. Unused paid minutes roll over for one billing cycle, then expire.</Text>
      {INTERPRETER_PLANS.map((plan) => (
        <Card key={plan.id}>
          <View style={styles.planHeader}><Text style={styles.planName}>{plan.name}</Text><Text style={styles.planPrice}>{plan.price}</Text></View>
          <Text style={styles.allowance}>{plan.allowance}</Text>
          {plan.features.map((feature) => <Text key={feature} style={styles.feature}>• {feature}</Text>)}
          {plan.productId ? <PrimaryButton disabled={busy} label={`Choose ${plan.name}`} onPress={() => void purchase(plan.productId)} /> : null}
        </Card>
      ))}
      {!membershipConfigured() ? <ConfigurationNotice service="Google Play subscriptions" /> : null}
    </View>
  );
}

function BillingContent() {
  const { user } = useAuth();
  const restore = async () => {
    if (!user) return Alert.alert('Sign in required', 'Sign in before restoring purchases.');
    try { await configureMembership(user.id); await restoreMembership(); Alert.alert('Purchases restored'); }
    catch (error) { Alert.alert('Restore failed', error instanceof Error ? error.message : 'Unable to restore purchases.'); }
  };
  return <View><Text style={styles.intro}>Google Play securely manages payment methods, receipts, renewals, cancellations, and eligible refunds.</Text><PrimaryButton label="Manage Google Play Subscription" onPress={() => void openGooglePlaySubscriptions()} /><SecondaryButton label="Restore Purchases" onPress={() => void restore()} /></View>;
}

function SettingsContent() {
  return <View><Card><Text style={styles.cardTitle}>Speaker output</Text><Text style={styles.cardBody}>Translated speech plays through the device speaker during an active conversation.</Text></Card><Card><Text style={styles.cardTitle}>Realtime audio protection</Text><Text style={styles.cardBody}>Noise handling, echo protection, and automatic reconnection remain enabled to protect two-way interpretation.</Text></Card></View>;
}

function LanguagesContent() {
  return <View><Text style={styles.intro}>Language choices are controlled by the two speaker rows on the home screen. Each row defines an explicit source and destination to keep interpretation accurate.</Text><Card><Text style={styles.cardTitle}>Saved defaults</Text><Text style={styles.cardBody}>Account-based saved language defaults will activate when account services are configured.</Text></Card></View>;
}

function NotificationsContent() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState(DEFAULT_NOTIFICATIONS);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) return;
    void authenticatedRequest<{ notifications?: NotificationPreferences }>('/api/v1/account/me')
      .then((account) => account.notifications && setPreferences(account.notifications))
      .catch(() => undefined);
  }, [user]);
  if (!user) return <ConfigurationNotice service="Notification preferences (sign-in required)" />;
  const update = async (key: keyof NotificationPreferences, value: boolean) => {
    const next = { ...preferences, [key]: value }; setPreferences(next);
    try { await authenticatedRequest('/api/v1/notifications/preferences', { method: 'PUT', body: JSON.stringify(next) }); }
    catch (error) { Alert.alert('Unable to save', error instanceof Error ? error.message : 'Try again.'); }
  };
  const enable = async () => { setBusy(true); try { await registerForAccountNotifications(); Alert.alert('Notifications enabled'); } catch (error) { Alert.alert('Unable to enable notifications', error instanceof Error ? error.message : 'Try again.'); } finally { setBusy(false); } };
  return <View><SettingRow label="Membership reminders" onChange={(v) => void update('membership', v)} value={preferences.membership} /><SettingRow label="Product updates" onChange={(v) => void update('product_updates', v)} value={preferences.product_updates} /><SettingRow label="New languages" onChange={(v) => void update('new_languages', v)} value={preferences.new_languages} /><SettingRow label="Service alerts" onChange={(v) => void update('service_alerts', v)} value={preferences.service_alerts} /><SettingRow label="Marketing" onChange={(v) => void update('marketing', v)} value={preferences.marketing} /><PrimaryButton disabled={busy} label="Enable Device Notifications" onPress={() => void enable()} /></View>;
}

function HelpContent() {
  const faqs = [
    ['How do conversations work?', 'Choose both speaker languages, tap Start Conversation, and take turns speaking.'],
    ['How do I improve accuracy?', 'Reduce background noise, speak clearly, and confirm names, numbers, prices, and addresses.'],
    ['Why did audio stop?', 'Confirm microphone permission, speaker volume, and network access, then end and restart the conversation.'],
    ['Is this for emergencies?', 'No. AI translation can make mistakes and is not a substitute for a qualified professional.'],
  ];
  return <View>{faqs.map(([question, answer]) => <Card key={question}><Text style={styles.cardTitle}>{question}</Text><Text style={styles.cardBody}>{answer}</Text></Card>)}</View>;
}

function SupportContent() {
  return <View><Text style={styles.intro}>Include your device, app version, approximate time, and steps taken. Never send passwords, card details, identification numbers, or private conversation recordings.</Text><PrimaryButton label="Email support@interpreter.ai" onPress={() => void Linking.openURL('mailto:support@interpreter.ai?subject=Interpreter%20Support')} /><Text style={styles.caption}>Support is not an emergency channel.</Text></View>;
}

function ConfigurationNotice({ service }: { service: string }) { return <View style={styles.notice}><Text style={styles.noticeTitle}>{service} are not active yet</Text><Text style={styles.noticeBody}>The production integration is ready for its public project keys and server configuration. The interpreter remains available without exposing secrets.</Text></View>; }
function Card({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
function Label({ children }: { children: React.ReactNode }) { return <Text style={styles.fieldLabel}>{children}</Text>; }
function PrimaryButton({ disabled = false, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.secondaryButton}><Text style={styles.secondaryText}>{label}</Text></Pressable>; }
function SettingRow({ label, onChange, value }: { label: string; onChange: (value: boolean) => void; value: boolean }) { return <View style={styles.settingRow}><Text style={styles.settingLabel}>{label}</Text><Switch onValueChange={onChange} trackColor={{ false: '#D0D5DD', true: '#8BB6FF' }} thumbColor={value ? '#075BFF' : '#F2F4F7'} value={value} /></View>; }

const BLUE = '#075BFF';
const styles = StyleSheet.create({
  page: { backgroundColor: '#FFFFFF', flex: 1 },
  header: { alignItems: 'center', borderBottomColor: '#EEF1F6', borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: 14, paddingTop: 48 },
  back: { alignItems: 'center', height: 58, justifyContent: 'center', width: 50 },
  backText: { color: BLUE, fontSize: 45, fontWeight: '300', lineHeight: 48 },
  title: { color: '#101828', flex: 1, fontSize: 21, fontWeight: '700', textAlign: 'center' },
  headerSpacer: { width: 50 },
  content: { padding: 22, paddingBottom: 48 },
  intro: { color: '#475467', fontSize: 15, lineHeight: 23, marginBottom: 18 },
  card: { backgroundColor: '#FFFFFF', borderColor: '#E3E8F1', borderRadius: 18, borderWidth: 1, marginBottom: 14, padding: 17, shadowColor: '#153A78', shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.05, shadowRadius: 10 },
  cardTitle: { color: '#101828', fontSize: 16, fontWeight: '700' },
  cardBody: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 7 },
  planHeader: { alignItems: 'center', flexDirection: 'row' },
  planName: { color: '#101828', flex: 1, fontSize: 19, fontWeight: '800' },
  planPrice: { color: BLUE, fontSize: 16, fontWeight: '700' },
  allowance: { color: '#344054', fontSize: 14, fontWeight: '600', marginBottom: 10, marginTop: 8 },
  feature: { color: '#667085', fontSize: 13, lineHeight: 21 },
  input: { backgroundColor: '#FFFFFF', borderColor: '#D8DFEA', borderRadius: 13, borderWidth: 1, fontSize: 16, marginBottom: 12, minHeight: 52, paddingHorizontal: 14 },
  acceptRow: { alignItems: 'center', flexDirection: 'row', marginVertical: 8 },
  checkbox: { color: BLUE, fontSize: 24, marginRight: 9 },
  acceptText: { color: '#475467', flex: 1, fontSize: 13, lineHeight: 19 },
  primaryButton: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 24, justifyContent: 'center', marginTop: 15, minHeight: 50, paddingHorizontal: 18 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { alignItems: 'center', borderColor: BLUE, borderRadius: 24, borderWidth: 1, justifyContent: 'center', marginTop: 12, minHeight: 50, paddingHorizontal: 18 },
  secondaryText: { color: BLUE, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  linkButton: { alignItems: 'center', marginTop: 18, padding: 8 },
  link: { color: BLUE, fontSize: 14, fontWeight: '600' },
  message: { color: '#B42318', fontSize: 13, lineHeight: 19, marginTop: 8 },
  fieldLabel: { color: '#667085', fontSize: 12, fontWeight: '700' },
  value: { color: '#101828', fontSize: 17, marginTop: 6 },
  caption: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 14, textAlign: 'center' },
  dangerButton: { alignItems: 'center', borderColor: '#FDA29B', borderRadius: 22, borderWidth: 1, marginTop: 20, padding: 13 },
  dangerText: { color: '#D92D20', fontSize: 15, fontWeight: '700' },
  settingRow: { alignItems: 'center', borderBottomColor: '#EAECF0', borderBottomWidth: 1, flexDirection: 'row', minHeight: 62 },
  settingLabel: { color: '#101828', flex: 1, fontSize: 16 },
  notice: { backgroundColor: '#EFF5FF', borderRadius: 16, marginTop: 16, padding: 16 },
  noticeTitle: { color: '#1849A9', fontSize: 15, fontWeight: '700' },
  noticeBody: { color: '#475467', fontSize: 13, lineHeight: 20, marginTop: 5 },
});
