import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Circle, Path } from 'react-native-svg';

import type { InterpreterContact } from '../contacts/ContactsProvider';

const BLUE = '#075BFF';

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
export type TranslatorVoicePreference = 'male' | 'female';

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

export function CallLanguageSelection({ contact, onBack, onContactPress, onStart }: {
  contact: InterpreterContact;
  onBack: () => void;
  onContactPress: () => void;
  onStart: (callerLanguage: CallLanguage, recipientLanguage: CallLanguage, translatorVoicePreference: TranslatorVoicePreference) => void;
}) {
  const [callerLanguage, setCallerLanguage] = useState<CallLanguage>('English');
  const [recipientLanguage, setRecipientLanguage] = useState<CallLanguage>('Spanish');
  const [translatorVoicePreference, setTranslatorVoicePreference] = useState<TranslatorVoicePreference>('female');
  const [editing, setEditing] = useState<'caller' | 'recipient' | null>(null);
  const sameLanguage = callerLanguage === recipientLanguage;

  const choose = (language: CallLanguage) => {
    if (editing === 'caller') setCallerLanguage(language);
    if (editing === 'recipient') setRecipientLanguage(language);
    setEditing(null);
  };

  return <View style={styles.screen}>
    <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Contacts</Text></Pressable>
    <Text style={styles.eyebrow}>INTERPRETER CALLING</Text>
    <Text style={styles.title}>Choose call languages</Text>
    <Pressable accessibilityLabel="View contact details" accessibilityRole="button" onPress={onContactPress} style={({ pressed }) => [styles.contactCard, pressed && styles.pressed]}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text></View>
      <View style={styles.contactCopy}><Text numberOfLines={1} style={styles.contactName}>{contact.displayName}</Text><Text style={styles.contactType}>Voice Call</Text></View>
    </Pressable>
    <View style={styles.languageStack}>
      <LanguageControl label="I speak" onPress={() => setEditing('caller')} value={callerLanguage} />
      <Text accessibilityElementsHidden style={styles.directionArrow}>⇅</Text>
      <LanguageControl label="They speak" onPress={() => setEditing('recipient')} value={recipientLanguage} />
    </View>
    <View style={styles.voiceSection}>
      <Text style={styles.voiceLabel}>Translator voice</Text>
      <View style={styles.voiceOptions}>
        {(['male', 'female'] as const).map((preference) => {
          const selected = translatorVoicePreference === preference;
          return <Pressable
            key={preference}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => setTranslatorVoicePreference(preference)}
            style={({ pressed }) => [styles.voiceOption, selected && styles.voiceOptionSelected, pressed && styles.pressed]}
          >
            <Text style={[styles.voiceOptionText, selected && styles.voiceOptionTextSelected]}>{preference === 'male' ? 'Male' : 'Female'}</Text>
          </Pressable>;
        })}
      </View>
    </View>
    <Text style={[styles.summary, sameLanguage && styles.warning]}>
      {sameLanguage ? 'Choose two different languages.' : <>You hear <Text style={styles.summaryStrong}>{callerLanguage}</Text>. {contact.givenName || contact.displayName} hears <Text style={styles.summaryStrong}>{recipientLanguage}</Text>.</>}
    </Text>
    <Pressable accessibilityRole="button" disabled={sameLanguage} onPress={() => onStart(callerLanguage, recipientLanguage, translatorVoicePreference)} style={({ pressed }) => [styles.start, sameLanguage && styles.disabled, pressed && styles.pressed]}>
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
  voiceSection: { marginTop: 22 },
  voiceLabel: { color: '#667085', fontSize: 14, marginBottom: 9 },
  voiceOptions: { backgroundColor: 'rgba(255,255,255,0.28)', borderRadius: 23, flexDirection: 'row', padding: 4 },
  voiceOption: { alignItems: 'center', borderRadius: 19, flex: 1, justifyContent: 'center', minHeight: 42 },
  voiceOptionSelected: { backgroundColor: '#FFFFFF' },
  voiceOptionText: { color: '#667085', fontSize: 15, fontWeight: '600' },
  voiceOptionTextSelected: { color: BLUE, fontWeight: '800' },
  summary: { color: '#344054', fontSize: 14, lineHeight: 21, marginTop: 25, textAlign: 'center' },
  summaryStrong: { color: BLUE, fontWeight: '700' },
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
