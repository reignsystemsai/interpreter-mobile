import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';

import type { InterpreterContact } from '../contacts/ContactsProvider';

const BLUE = '#075BFF';

export const CALL_LANGUAGES = ['English', 'Spanish', 'Brazilian Portuguese', 'French', 'German', 'Italian', 'Russian', 'Mandarin Chinese', 'Japanese', 'Korean', 'Hindi', 'Indonesian', 'Vietnamese'] as const;
export type CallLanguage = typeof CALL_LANGUAGES[number];
export type CallVoice = 'female' | 'male';

export function CallLanguageSelection({ contact, onBack, onContactPress, onStart }: {
  contact: InterpreterContact;
  onBack: () => void;
  onContactPress: () => void;
  onStart: (callerLanguage: CallLanguage, recipientLanguage: CallLanguage, callerVoice: CallVoice, recipientVoice: CallVoice) => void;
}) {
  const [callerLanguage, setCallerLanguage] = useState<CallLanguage>('English');
  const [recipientLanguage, setRecipientLanguage] = useState<CallLanguage>('Spanish');
  const [callerVoice, setCallerVoice] = useState<CallVoice>('female');
  const [recipientVoice, setRecipientVoice] = useState<CallVoice>('male');
  const [editing, setEditing] = useState<'caller' | 'recipient' | null>(null);
  const sameLanguage = callerLanguage === recipientLanguage;
  const choose = (language: CallLanguage) => {
    if (editing === 'caller') setCallerLanguage(language);
    if (editing === 'recipient') setRecipientLanguage(language);
    setEditing(null);
  };

  return <View style={styles.screen}>
    <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>Contacts</Text></Pressable>
    <Text style={styles.title}>Choose call languages</Text>
    <Pressable accessibilityRole="button" onPress={onContactPress} style={styles.contact}><Text style={styles.contactName}>{contact.displayName}</Text></Pressable>
    <LanguageVoiceRow label="I speak" language={callerLanguage} onLanguage={() => setEditing('caller')} onVoice={setCallerVoice} voice={callerVoice} />
    <LanguageVoiceRow label="They speak" language={recipientLanguage} onLanguage={() => setEditing('recipient')} onVoice={setRecipientVoice} voice={recipientVoice} />
    <Pressable accessibilityRole="button" disabled={sameLanguage} onPress={() => onStart(callerLanguage, recipientLanguage, callerVoice, recipientVoice)} style={[styles.start, sameLanguage && styles.disabled]}><Text style={styles.startText}>Start Voice Call</Text></Pressable>
    <Modal animationType="fade" onRequestClose={() => setEditing(null)} transparent visible={editing !== null}>
      <BlurView intensity={34} style={styles.backdrop} tint="light"><View style={styles.sheet}><Text style={styles.sheetTitle}>{editing === 'caller' ? 'I speak' : 'They speak'}</Text><ScrollView>{CALL_LANGUAGES.map((language) => <Pressable key={language} onPress={() => choose(language)} style={styles.option}><Text style={styles.optionText}>{language}</Text></Pressable>)}</ScrollView></View></BlurView>
    </Modal>
  </View>;
}

function LanguageVoiceRow({ label, language, onLanguage, onVoice, voice }: { label: string; language: CallLanguage; onLanguage: () => void; onVoice: (voice: CallVoice) => void; voice: CallVoice }) {
  return <View style={styles.language}><Pressable accessibilityLabel={`Choose ${label} language`} accessibilityRole="button" onPress={onLanguage} style={styles.languageChoice}><Text style={styles.label}>{label}</Text><Text numberOfLines={1} style={styles.value}>{language}</Text></Pressable><View accessibilityLabel={`${label} voice`} style={styles.voiceChoices}>{(['male', 'female'] as const).map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: voice === option }} onPress={() => onVoice(option)} style={[styles.voiceChoice, voice === option && (option === 'female' ? styles.voiceFemaleSelected : styles.voiceMaleSelected)]}><Text style={[styles.voiceChoiceText, voice === option && styles.voiceChoiceTextSelected]}>{option === 'male' ? 'Male' : 'Female'}</Text></Pressable>)}</View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, back: { alignSelf: 'flex-start', marginBottom: 13, paddingVertical: 5 }, backText: { color: BLUE, fontSize: 16, fontWeight: '600' }, title: { color: '#101828', fontSize: 28, fontWeight: '800' }, contact: { marginTop: 22 }, contactName: { color: '#344054', fontSize: 18, fontWeight: '700' }, language: { alignItems: 'center', borderColor: '#DDE5F1', borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginTop: 16, minHeight: 78, padding: 12 }, languageChoice: { flex: 1, minWidth: 0, paddingHorizontal: 4, paddingVertical: 4 }, label: { color: '#667085', fontSize: 14 }, value: { color: '#101828', fontSize: 18, fontWeight: '700', marginTop: 4 }, voiceChoices: { backgroundColor: '#F3F6FA', borderRadius: 17, flexDirection: 'row', padding: 3 }, voiceChoice: { borderRadius: 14, paddingHorizontal: 9, paddingVertical: 8 }, voiceMaleSelected: { backgroundColor: BLUE }, voiceFemaleSelected: { backgroundColor: '#FF3E91' }, voiceChoiceText: { color: '#667085', fontSize: 11, fontWeight: '700' }, voiceChoiceTextSelected: { color: '#FFFFFF' }, start: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 18, marginTop: 24, paddingVertical: 16 }, startText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' }, disabled: { opacity: 0.45 }, backdrop: { backgroundColor: 'rgba(8,18,38,0.16)', flex: 1, justifyContent: 'flex-end' }, sheet: { backgroundColor: '#F8FBFF', maxHeight: '78%', padding: 22 }, sheetTitle: { color: '#101828', fontSize: 22, fontWeight: '800', marginBottom: 10 }, option: { paddingVertical: 14 }, optionText: { color: '#101828', fontSize: 17 },
});
