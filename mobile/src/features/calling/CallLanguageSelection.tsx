import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';

import type { InterpreterContact } from '../contacts/ContactsProvider';

const BLUE = '#075BFF';

export const CALL_LANGUAGES = ['English', 'Spanish', 'Brazilian Portuguese', 'French', 'German', 'Italian', 'Russian', 'Mandarin Chinese', 'Japanese', 'Korean', 'Hindi', 'Indonesian', 'Vietnamese'] as const;
export type CallLanguage = typeof CALL_LANGUAGES[number];

export function CallLanguageSelection({ contact, onBack, onContactPress, onStart }: {
  contact: InterpreterContact;
  onBack: () => void;
  onContactPress: () => void;
  onStart: (callerLanguage: CallLanguage, recipientLanguage: CallLanguage) => void;
}) {
  const [callerLanguage, setCallerLanguage] = useState<CallLanguage>('English');
  const [recipientLanguage, setRecipientLanguage] = useState<CallLanguage>('Spanish');
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
    <Pressable accessibilityRole="button" onPress={() => setEditing('caller')} style={styles.language}><Text style={styles.label}>I speak</Text><Text style={styles.value}>{callerLanguage}</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => setEditing('recipient')} style={styles.language}><Text style={styles.label}>They speak</Text><Text style={styles.value}>{recipientLanguage}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={sameLanguage} onPress={() => onStart(callerLanguage, recipientLanguage)} style={[styles.start, sameLanguage && styles.disabled]}><Text style={styles.startText}>Start Voice Call</Text></Pressable>
    <Modal animationType="fade" onRequestClose={() => setEditing(null)} transparent visible={editing !== null}>
      <BlurView intensity={34} style={styles.backdrop} tint="light"><View style={styles.sheet}><Text style={styles.sheetTitle}>{editing === 'caller' ? 'I speak' : 'They speak'}</Text><ScrollView>{CALL_LANGUAGES.map((language) => <Pressable key={language} onPress={() => choose(language)} style={styles.option}><Text style={styles.optionText}>{language}</Text></Pressable>)}</ScrollView></View></BlurView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, back: { alignSelf: 'flex-start', marginBottom: 13, paddingVertical: 5 }, backText: { color: BLUE, fontSize: 16, fontWeight: '600' }, title: { color: '#101828', fontSize: 28, fontWeight: '800' }, contact: { marginTop: 22 }, contactName: { color: '#344054', fontSize: 18, fontWeight: '700' }, language: { borderColor: '#DDE5F1', borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 16 }, label: { color: '#667085', fontSize: 14 }, value: { color: '#101828', fontSize: 19, fontWeight: '700', marginTop: 4 }, start: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 18, marginTop: 24, paddingVertical: 16 }, startText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' }, disabled: { opacity: 0.45 }, backdrop: { backgroundColor: 'rgba(8,18,38,0.16)', flex: 1, justifyContent: 'flex-end' }, sheet: { backgroundColor: '#F8FBFF', maxHeight: '78%', padding: 22 }, sheetTitle: { color: '#101828', fontSize: 22, fontWeight: '800', marginBottom: 10 }, option: { paddingVertical: 14 }, optionText: { color: '#101828', fontSize: 17 },
});