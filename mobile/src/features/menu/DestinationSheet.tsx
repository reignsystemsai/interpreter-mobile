import { useEffect, useState } from 'react';
import {
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
import { BlurView } from 'expo-blur';
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
import { CallUiPreview } from '../calling/CallUiPreview';
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
  if (destination === 'call_ui_preview') return <CallUiPreview onClose={onClose} />;
  const title = ({
    account: 'My Account',
    membership: 'Interpreter Pro',
    billing: 'Billing & Payments',
    settings: 'Settings',
    languages: 'Languages',
    notifications: 'Notifications',
    help: 'Help & FAQ',
    support: 'Contact Support',
  } as const)[destination === 'interpreter_calls' ? 'help' : destination ?? 'help'];
  if (destination === 'interpreter_calls') {
    return (
      <Modal animationType="fade" onRequestClose={onClose} transparent visible>
        <BlurView experimentalBlurMethod="dimezisBlurView" intensity={46} style={styles.infoBackdrop} tint="light">
          <Pressable accessibilityLabel="Close Interpreter Calls information" onPress={onClose} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={styles.infoSheet}>
            <Text style={styles.infoTitle}>Interpreter Calls</Text>
            <Text style={styles.infoBody}>Interpreter lets two people naturally communicate in different languages.</Text>
            <Text style={styles.infoBody}>Each participant chooses:</Text>
            <Text style={styles.infoPoint}>• The language they speak.</Text>
            <Text style={styles.infoPoint}>• The language they want to hear.</Text>
            <Text style={styles.infoBody}>Interpreter translates the conversation in real time.</Text>
            <Text style={styles.infoClosing}>No switching apps.{`\n`}No typing.{`\n`}No passing the phone back and forth.{`\n`}Just conversation.</Text>
            <PrimaryButton label="✓ Got It" onPress={onClose} />
          </View>
        </BlurView>
      </Modal>
    );
  }
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={Boolean(destination)}>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={48} style={styles.destinationBackdrop} tint="light">
      <Pressable accessibilityLabel={`Close ${title}`} onPress={onClose} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={styles.page}>
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
      </BlurView>
    </Modal>
  );
}

function AccountContent() {
  return (
    <View>
      <Text style={styles.intro}>Account management is disabled in this build.</Text>
      <Text style={styles.cardBody}>This repository was cleaned of the previous Supabase account flow, so sign-in, profile syncing, and password recovery actions are unavailable until a new backend is configured.</Text>
      <FriendlyNotice title="Ready for a fresh setup" body="The app shell remains intact while account services are removed." />
    </View>
  );
}

function MembershipContent() {
  return (
    <View>
      <Text style={styles.intro}>Paid plans are unavailable in this cleaned build.</Text>
      <FriendlyNotice title="Membership service removed" body="Subscription access is disabled until a new backend is configured." />
    </View>
  );
}

function BillingContent() {
  return (
    <View>
      <Text style={styles.intro}>Google Play billing is unavailable in this cleaned build.</Text>
      <FriendlyNotice title="Billing disabled" body="Help and support remain available, but subscription billing has been removed." />
    </View>
  );
}

function SettingsContent() {
  return <View><Card><Text style={styles.cardTitle}>Speaker output</Text><Text style={styles.cardBody}>Translated speech plays through the device speaker during an active conversation.</Text></Card><Card><Text style={styles.cardTitle}>Realtime audio protection</Text><Text style={styles.cardBody}>Noise handling, echo protection, and automatic reconnection remain enabled to protect two-way interpretation.</Text></Card></View>;
}

function LanguagesContent() {
  return <View><Text style={styles.intro}>Language choices are controlled by the two speaker rows on the home screen. Each row defines an explicit source and destination to keep interpretation accurate.</Text><Card><Text style={styles.cardTitle}>Your language choices</Text><Text style={styles.cardBody}>Interpreter remembers the language pair selected on the home screen.</Text></Card></View>;
}

function NotificationsContent() {
  return (
    <View>
      <FriendlyNotice title="Notifications are unavailable" body="Push notification preferences are disabled while account services are removed." />
    </View>
  );
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

function GuestAccountIntroduction() { return <FriendlyNotice title="Try Interpreter free" body="Make your first interpreted call now. Create your account when you are ready to keep your preferences across devices." />; }
function FriendlyNotice({ body, title }: { body: string; title: string }) { return <View style={styles.notice}><Text style={styles.noticeTitle}>{title}</Text><Text style={styles.noticeBody}>{body}</Text></View>; }
function Card({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
function Label({ children }: { children: React.ReactNode }) { return <Text style={styles.fieldLabel}>{children}</Text>; }
function PrimaryButton({ disabled = false, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.secondaryButton}><Text style={styles.secondaryText}>{label}</Text></Pressable>; }
function SettingRow({ label, onChange, value }: { label: string; onChange: (value: boolean) => void; value: boolean }) { return <View style={styles.settingRow}><Text style={styles.settingLabel}>{label}</Text><Switch onValueChange={onChange} trackColor={{ false: '#D0D5DD', true: '#8BB6FF' }} thumbColor={value ? '#075BFF' : '#F2F4F7'} value={value} /></View>; }

const BLUE = '#075BFF';
const styles = StyleSheet.create({
  destinationBackdrop: { backgroundColor: 'rgba(9,28,64,0.14)', flex: 1, justifyContent: 'flex-end', paddingHorizontal: 10, paddingTop: 40 },
  page: { backgroundColor: 'rgba(248,251,255,0.70)', borderColor: 'rgba(255,255,255,0.96)', borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, maxHeight: '91%', overflow: 'hidden', shadowColor: '#164995', shadowOffset: { height: -8, width: 0 }, shadowOpacity: 0.18, shadowRadius: 28 },
  header: { alignItems: 'center', borderBottomColor: 'rgba(180,197,225,0.35)', borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: 14, paddingTop: 6 },
  back: { alignItems: 'center', height: 58, justifyContent: 'center', width: 50 },
  backText: { color: BLUE, fontSize: 45, fontWeight: '300', lineHeight: 48 },
  title: { color: '#101828', flex: 1, fontSize: 21, fontWeight: '700', textAlign: 'center' },
  headerSpacer: { width: 50 },
  content: { padding: 22, paddingBottom: 48 },
  intro: { color: '#475467', fontSize: 15, lineHeight: 23, marginBottom: 18 },
  card: { backgroundColor: 'rgba(255,255,255,0.74)', borderColor: 'rgba(255,255,255,0.92)', borderRadius: 18, borderWidth: 1, marginBottom: 14, padding: 17, shadowColor: '#153A78', shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.07, shadowRadius: 12 },
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
  infoBackdrop: { flex: 1, justifyContent: 'flex-end' },
  infoSheet: { backgroundColor: 'rgba(248,251,255,0.70)', borderColor: 'rgba(255,255,255,0.9)', borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, paddingBottom: 34, paddingHorizontal: 26, paddingTop: 30, shadowColor: '#164995', shadowOffset: { height: -8, width: 0 }, shadowOpacity: 0.14, shadowRadius: 24 },
  infoTitle: { color: '#101828', fontSize: 26, fontWeight: '800', marginBottom: 14 },
  infoBody: { color: '#475467', fontSize: 15, lineHeight: 23, marginTop: 9 },
  infoPoint: { color: '#344054', fontSize: 15, lineHeight: 23, paddingLeft: 8 },
  infoClosing: { color: BLUE, fontSize: 16, fontWeight: '700', lineHeight: 25, marginTop: 16 },
});
