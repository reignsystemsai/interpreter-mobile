import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as SecureStore from 'expo-secure-store';
import Svg, { Circle, Path } from 'react-native-svg';

import type { InterpreterContact } from '../contacts/ContactsProvider';
import {
  adjacentVoiceId,
  SPEAK_VOICE_OPTIONS,
  voiceSelection,
  type CallVoiceId,
  type VoiceCategory,
} from './voiceCatalog';
import { useVoicePreviewPlayer, type VoicePreviewStatus } from './useVoicePreviewPlayer';

const BLUE = '#075BFF';
const PINK = '#F43F8A';

export const CALL_LANGUAGES = [
  'English',
  'Spanish',
  'Brazilian Portuguese',
  'French',
  'German',
  'Italian',
  'Russian',
  'Mandarin Chinese',
  'Japanese',
  'Korean',
  'Hindi',
  'Indonesian',
  'Vietnamese',
] as const;

export type CallLanguage = typeof CALL_LANGUAGES[number];
export type CallVoiceSelection = { category: VoiceCategory; voiceId: CallVoiceId };
export type CallVoicePreferences = { caller: CallVoiceSelection; recipient: CallVoiceSelection };
export type CallVoiceSnapshot = Readonly<{ callerHearsVoiceId: CallVoiceId; recipientHearsVoiceId: CallVoiceId }>;

export const DEFAULT_CALL_VOICE_PREFERENCES: CallVoicePreferences = {
  caller: { category: 'male', voiceId: 'cedar' },
  recipient: { category: 'female', voiceId: 'marin' },
};
export const DEFAULT_CALL_VOICE_SNAPSHOT: CallVoiceSnapshot = Object.freeze({ callerHearsVoiceId: 'cedar', recipientHearsVoiceId: 'marin' });

const VOICE_KEYS = {
  callerCategory: 'speak.callVoice.caller.category',
  callerVoiceId: 'speak.callVoice.caller.voiceId',
  recipientCategory: 'speak.callVoice.recipient.category',
  recipientVoiceId: 'speak.callVoice.recipient.voiceId',
} as const;

function validCategory(value: string | null, fallback: VoiceCategory): VoiceCategory {
  return value === 'male' || value === 'female' ? value : fallback;
}

function selectionFor(category: VoiceCategory, voiceId?: string | null): CallVoiceSelection {
  return voiceSelection(category, voiceId);
}

function GlobeIcon() {
  return <Svg height={31} viewBox="0 0 32 32" width={31}>
    <Circle cx={16} cy={16} fill="none" r={13} stroke={BLUE} strokeWidth={2} />
    <Path d="M3 16h26M16 3c4 4 6 8.4 6 13s-2 9-6 13M16 3c-4 4-6 8.4-6 13s2 9 6 13" fill="none" stroke={BLUE} strokeLinecap="round" strokeWidth={1.7} />
  </Svg>;
}

function ChevronIcon() {
  return <Svg height={18} viewBox="0 0 24 24" width={18}><Path d="m5 9 7 7 7-7" fill="none" stroke={BLUE} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} /></Svg>;
}

function PhoneIcon() {
  return <Svg height={23} viewBox="0 0 24 24" width={23}><Path d="M6.7 3.1 9 2.5c.7-.2 1.4.2 1.7.9l1 2.8c.2.6 0 1.2-.5 1.6L9.7 9a14.5 14.5 0 0 0 5.3 5.3l1.2-1.5c.4-.5 1-.7 1.6-.5l2.8 1c.7.3 1.1 1 1 1.7l-.6 2.3a3 3 0 0 1-3 2.3A15.4 15.4 0 0 1 4.4 6a3 3 0 0 1 2.3-2.9Z" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} /></Svg>;
}

function LanguageControl({ label, onPress, value }: { label: string; onPress: () => void; value: CallLanguage }) {
  return <Pressable accessibilityLabel={`${label}: ${value}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.languageControl, pressed && styles.pressed]}>
    <GlobeIcon />
    <View style={styles.languageCopy}><Text style={styles.languageLabel}>{label}</Text><Text numberOfLines={1} style={styles.languageValue}>{value}</Text></View>
    <ChevronIcon />
  </Pressable>;
}

function VoiceChoiceControl({ accent, selection, sideLabel, onCategoryChange, onPreview, onVoiceStep, previewError, previewStatus }: {
  accent: string;
  selection: CallVoiceSelection;
  sideLabel: string;
  onCategoryChange: (category: VoiceCategory) => void;
  onPreview: () => void;
  onVoiceStep: (direction: -1 | 1) => void;
  previewError: string;
  previewStatus: VoicePreviewStatus;
}) {
  const voiceLabel = SPEAK_VOICE_OPTIONS.find((candidate) => candidate.id === selection.voiceId)?.label ?? 'Voice 1';
  const previewActive = previewStatus === 'loading' || previewStatus === 'playing';
  return <View style={styles.voiceCard}>
    <Text style={[styles.voiceSideLabel, { color: accent }]}>{sideLabel}</Text>
    <Text style={styles.voiceLabel}>Voice options</Text>
    <View style={styles.voiceNavigator}>
      <Pressable accessibilityLabel={`Previous ${sideLabel} voice`} accessibilityRole="button" onPress={() => onVoiceStep(-1)} style={({ pressed }) => [styles.voiceArrow, pressed && styles.pressed]}><Text style={styles.voiceArrowText}>‹</Text></Pressable>
      <Text style={styles.voiceName}>{voiceLabel}</Text>
      <Pressable
        accessibilityLabel={`${previewActive ? 'Stop' : 'Play'} ${sideLabel} voice preview`}
        accessibilityRole="button"
        onPress={onPreview}
        style={({ pressed }) => [styles.previewButton, pressed && styles.pressed]}
      >
        {previewStatus === 'loading'
          ? <ActivityIndicator color={accent} size="small" />
          : <Text style={[styles.previewIcon, { color: accent }]}>{previewStatus === 'playing' ? '■' : '▶'}</Text>}
      </Pressable>
      <Pressable accessibilityLabel={`Next ${sideLabel} voice`} accessibilityRole="button" onPress={() => onVoiceStep(1)} style={({ pressed }) => [styles.voiceArrow, pressed && styles.pressed]}><Text style={styles.voiceArrowText}>›</Text></Pressable>
    </View>
    {previewError ? <Text accessibilityLiveRegion="polite" style={styles.previewError}>{previewError}</Text> : null}
    <View style={styles.categoryOptions}>
      {(['male', 'female'] as const).map((category) => {
        const selected = selection.category === category;
        return <Pressable
          key={category}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected }}
          onPress={() => onCategoryChange(category)}
          style={[styles.categoryOption, selected && { backgroundColor: accent }]}
        >
          <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{category === 'male' ? 'Male' : 'Female'}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

export function CallLanguageSelection({ contact, onBack, onContactPress, onStart }: {
  contact: InterpreterContact;
  onBack: () => void;
  onContactPress: () => void;
  onStart: (callerLanguage: CallLanguage, recipientLanguage: CallLanguage, voices: CallVoiceSnapshot) => void;
}) {
  const [callerLanguage, setCallerLanguage] = useState<CallLanguage>('English');
  const [recipientLanguage, setRecipientLanguage] = useState<CallLanguage>('Spanish');
  const [voicePreferences, setVoicePreferences] = useState<CallVoicePreferences>(DEFAULT_CALL_VOICE_PREFERENCES);
  const [voicePreferencesRestored, setVoicePreferencesRestored] = useState(false);
  const [editing, setEditing] = useState<'caller' | 'recipient' | null>(null);
  const sameLanguage = callerLanguage === recipientLanguage;
  const { state: previewState, stopPreview, togglePreview } = useVoicePreviewPlayer();

  useEffect(() => {
    let active = true;
    void Promise.all([
      SecureStore.getItemAsync(VOICE_KEYS.callerCategory),
      SecureStore.getItemAsync(VOICE_KEYS.callerVoiceId),
      SecureStore.getItemAsync(VOICE_KEYS.recipientCategory),
      SecureStore.getItemAsync(VOICE_KEYS.recipientVoiceId),
    ]).then(([callerCategoryValue, callerVoiceId, recipientCategoryValue, recipientVoiceId]) => {
      if (!active) return;
      const callerCategory = validCategory(callerCategoryValue, 'male');
      const recipientCategory = validCategory(recipientCategoryValue, 'female');
      setVoicePreferences({ caller: selectionFor(callerCategory, callerVoiceId), recipient: selectionFor(recipientCategory, recipientVoiceId) });
    }).catch(() => undefined).finally(() => { if (active) setVoicePreferencesRestored(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!voicePreferencesRestored) return;
    void Promise.all([
      SecureStore.setItemAsync(VOICE_KEYS.callerCategory, voicePreferences.caller.category),
      SecureStore.setItemAsync(VOICE_KEYS.callerVoiceId, voicePreferences.caller.voiceId),
      SecureStore.setItemAsync(VOICE_KEYS.recipientCategory, voicePreferences.recipient.category),
      SecureStore.setItemAsync(VOICE_KEYS.recipientVoiceId, voicePreferences.recipient.voiceId),
    ]).catch(() => undefined);
  }, [voicePreferences, voicePreferencesRestored]);

  const choose = (language: CallLanguage) => {
    if (editing === 'caller') setCallerLanguage(language);
    if (editing === 'recipient') setRecipientLanguage(language);
    setEditing(null);
  };

  const chooseVoiceCategory = (side: keyof CallVoicePreferences, category: VoiceCategory) => {
    stopPreview();
    setVoicePreferences((current) => ({ ...current, [side]: selectionFor(category) }));
  };

  const stepVoice = (side: keyof CallVoicePreferences, direction: -1 | 1) => {
    stopPreview();
    setVoicePreferences((current) => {
      const selection = current[side];
      return { ...current, [side]: { ...selection, voiceId: adjacentVoiceId(selection.category, selection.voiceId, direction) } };
    });
  };

  const start = () => {
    stopPreview();
    const caller = selectionFor(voicePreferences.caller.category, voicePreferences.caller.voiceId);
    const recipient = selectionFor(voicePreferences.recipient.category, voicePreferences.recipient.voiceId);
    const snapshot: CallVoiceSnapshot = Object.freeze({ callerHearsVoiceId: caller.voiceId, recipientHearsVoiceId: recipient.voiceId });
    onStart(callerLanguage, recipientLanguage, snapshot);
  };

  return <View style={styles.screen}>
    <Pressable accessibilityRole="button" onPress={() => { stopPreview(); onBack(); }} style={styles.back}><Text style={styles.backText}>‹ Contacts</Text></Pressable>
    <Text style={styles.eyebrow}>SPEAK CALLING</Text>
    <Text style={styles.title}>Choose call languages</Text>
    <Pressable accessibilityLabel="View contact details" accessibilityRole="button" onPress={() => { stopPreview(); onContactPress(); }} style={({ pressed }) => [styles.contactCard, pressed && styles.pressed]}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text></View>
      <View style={styles.contactCopy}><Text numberOfLines={1} style={styles.contactName}>{contact.displayName}</Text><Text style={styles.contactType}>Speak Voice Call</Text></View>
    </Pressable>
    <View style={styles.languageStack}>
      <LanguageControl label="I speak" onPress={() => setEditing('caller')} value={callerLanguage} />
      <Text accessibilityElementsHidden style={styles.directionArrow}>⇅</Text>
      <LanguageControl label="They speak" onPress={() => setEditing('recipient')} value={recipientLanguage} />
    </View>
    <View style={styles.voiceSection}>
      <VoiceChoiceControl
        accent={BLUE}
        onCategoryChange={(category) => chooseVoiceCategory('caller', category)}
        onPreview={() => void togglePreview('caller', voicePreferences.caller.voiceId)}
        onVoiceStep={(direction) => stepVoice('caller', direction)}
        previewError={previewState.side === 'caller' ? previewState.error : ''}
        previewStatus={previewState.side === 'caller' ? previewState.status : 'idle'}
        selection={voicePreferences.caller}
        sideLabel="You hear"
      />
      <VoiceChoiceControl
        accent={PINK}
        onCategoryChange={(category) => chooseVoiceCategory('recipient', category)}
        onPreview={() => void togglePreview('recipient', voicePreferences.recipient.voiceId)}
        onVoiceStep={(direction) => stepVoice('recipient', direction)}
        previewError={previewState.side === 'recipient' ? previewState.error : ''}
        previewStatus={previewState.side === 'recipient' ? previewState.status : 'idle'}
        selection={voicePreferences.recipient}
        sideLabel="They hear"
      />
    </View>
    {sameLanguage ? <Text style={[styles.summary, styles.warning]}>Choose two different languages.</Text> : null}
    <Pressable accessibilityRole="button" disabled={sameLanguage} onPress={start} style={({ pressed }) => [styles.start, sameLanguage && styles.disabled, pressed && styles.pressed]}>
      <PhoneIcon /><Text style={styles.startText}>Start Voice Call</Text>
    </Pressable>

    <Modal animationType="fade" onRequestClose={() => setEditing(null)} transparent visible={editing !== null}>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={34} style={styles.pickerBackdrop} tint="light">
        <Pressable accessibilityLabel="Close language choices" onPress={() => setEditing(null)} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.pickerSheet}>
          <View style={styles.handle} />
          <Text style={styles.pickerTitle}>{editing === 'caller' ? 'I speak' : 'They speak'}</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {CALL_LANGUAGES.map((language) => {
              const selected = editing === 'caller' ? callerLanguage === language : recipientLanguage === language;
              return <Pressable key={language} onPress={() => choose(language)} style={[styles.option, selected && styles.optionSelected]}>
                <Text style={styles.optionText}>{language}</Text>{selected ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>;
            })}
          </ScrollView>
        </View>
      </BlurView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { alignSelf: 'flex-start', marginBottom: 13, paddingVertical: 5 },
  backText: { color: BLUE, fontSize: 16, fontWeight: '600' },
  eyebrow: { color: BLUE, fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: '#101828', fontSize: 28, fontWeight: '800', marginTop: 5 },
  contactCard: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.34)', borderRadius: 27, flexDirection: 'row', marginTop: 22, minHeight: 88, paddingHorizontal: 15 },
  avatar: { alignItems: 'center', backgroundColor: '#EAF1FF', borderRadius: 30, height: 60, justifyContent: 'center', width: 60 },
  avatarText: { color: BLUE, fontSize: 25, fontWeight: '800' },
  contactCopy: { flex: 1, marginLeft: 15 },
  contactName: { color: '#101828', fontSize: 21, fontWeight: '800' },
  contactType: { color: '#667085', fontSize: 14, marginTop: 3 },
  languageStack: { marginTop: 28 },
  languageControl: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.34)', borderRadius: 27, flexDirection: 'row', minHeight: 82, paddingHorizontal: 18 },
  languageCopy: { flex: 1, marginLeft: 17 },
  languageLabel: { color: '#667085', fontSize: 14 },
  languageValue: { color: '#101828', fontSize: 21, fontWeight: '700', marginTop: 2 },
  directionArrow: { color: BLUE, fontSize: 30, lineHeight: 40, textAlign: 'center' },
  voiceSection: { flexDirection: 'row', gap: 10, marginTop: 22 },
  voiceCard: { backgroundColor: 'rgba(255,255,255,0.30)', borderRadius: 20, flex: 1, padding: 11 },
  voiceSideLabel: { fontSize: 11, fontWeight: '800' },
  voiceLabel: { color: '#667085', fontSize: 11, marginTop: 2 },
  voiceNavigator: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  voiceArrow: { alignItems: 'center', height: 25, justifyContent: 'center', width: 24 },
  voiceArrowText: { color: '#667085', fontSize: 23 },
  voiceName: { color: '#101828', fontSize: 14, fontWeight: '800' },
  previewButton: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  previewIcon: { fontSize: 13, fontWeight: '800' },
  previewError: { color: '#B42318', fontSize: 10, lineHeight: 14, marginTop: 4, textAlign: 'center' },
  categoryOptions: { backgroundColor: 'rgba(255,255,255,0.42)', borderRadius: 14, flexDirection: 'row', marginTop: 8, padding: 2 },
  categoryOption: { alignItems: 'center', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 28 },
  categoryText: { color: '#667085', fontSize: 10, fontWeight: '700' },
  categoryTextSelected: { color: '#FFFFFF' },
  summary: { color: '#344054', fontSize: 14, lineHeight: 21, marginTop: 25, textAlign: 'center' },
  warning: { color: '#B42318', fontWeight: '600' },
  start: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 29, flexDirection: 'row', justifyContent: 'center', marginTop: 24, minHeight: 58 },
  startText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginLeft: 11 },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.62 },
  pickerBackdrop: { backgroundColor: 'rgba(8,18,38,0.16)', flex: 1, justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: 'rgba(248,251,255,0.82)', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '78%', paddingBottom: 26, paddingHorizontal: 22, paddingTop: 12 },
  handle: { alignSelf: 'center', backgroundColor: '#CBD5E1', borderRadius: 3, height: 5, marginBottom: 17, width: 44 },
  pickerTitle: { color: '#101828', fontSize: 23, fontWeight: '800', marginBottom: 9 },
  option: { alignItems: 'center', borderRadius: 15, flexDirection: 'row', minHeight: 51, paddingHorizontal: 14 },
  optionSelected: { backgroundColor: '#EAF1FF' },
  optionText: { color: '#101828', flex: 1, fontSize: 16 },
  check: { color: BLUE, fontSize: 21, fontWeight: '800' },
});
