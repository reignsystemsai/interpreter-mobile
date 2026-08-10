import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SpeakMark } from '../../components/SpeakNavigation';
import type { InterpreterContact } from '../contacts/ContactsProvider';

const BLUE = '#1463FF';
const WHITE = '#FFFFFF';
const LANGUAGES = ['English', 'Spanish', 'Brazilian Portuguese', 'French', 'German', 'Italian', 'Dutch', 'Russian', 'Polish', 'Romanian', 'Turkish', 'Arabic', 'Hebrew', 'Hindi', 'Japanese', 'Korean', 'Mandarin Chinese', 'Cantonese', 'Vietnamese', 'Thai'];

export type InterpreterCallOptions = {
  callType: 'video' | 'voice';
  callerLanguage: string;
  recipientLanguage: string;
  voiceGender: 'female' | 'male';
};

export function InterpreterCallSetup({ contact, creating, initialCallerLanguage, initialRecipientLanguage, onBack, onStart }: {
  contact: InterpreterContact;
  creating: boolean;
  initialCallerLanguage: string;
  initialRecipientLanguage: string;
  onBack: () => void;
  onStart: (options: InterpreterCallOptions) => void;
}) {
  const [callType, setCallType] = useState<InterpreterCallOptions['callType']>('voice');
  const [callerLanguage, setCallerLanguage] = useState(initialCallerLanguage);
  const [recipientLanguage, setRecipientLanguage] = useState(initialRecipientLanguage);
  const [voiceGender, setVoiceGender] = useState<InterpreterCallOptions['voiceGender']>('male');
  const [languageTarget, setLanguageTarget] = useState<'caller' | 'recipient' | null>(null);

  const chooseLanguage = (language: string) => {
    if (languageTarget === 'caller') setCallerLanguage(language);
    if (languageTarget === 'recipient') setRecipientLanguage(language);
    setLanguageTarget(null);
  };

  return <View style={styles.page}>
    <View style={styles.setupHeader}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.back}>‹</Text></Pressable><SpeakMark compact /><View style={styles.backButton} /></View>
    <Text style={styles.eyebrow}>INTERPRETER</Text>
    <Text style={styles.title}>Set up your interpreted call</Text>

    <Text style={styles.label}>Call type</Text>
    <View style={styles.segment}>
      <Choice active={callType === 'voice'} label="Voice" onPress={() => setCallType('voice')} />
      <Choice active={callType === 'video'} label="Video" onPress={() => setCallType('video')} />
    </View>

    <Text style={styles.label}>Translated voice</Text>
    <View style={styles.segment}>
      <Choice active={voiceGender === 'male'} label="Male" onPress={() => setVoiceGender('male')} />
      <Choice active={voiceGender === 'female'} label="Female" onPress={() => setVoiceGender('female')} />
    </View>

    <Text style={styles.label}>Languages</Text>
    <Pressable onPress={() => setLanguageTarget('caller')} style={styles.languageRow}><Text style={styles.languageCaption}>You speak</Text><Text style={styles.languageValue}>{callerLanguage}  ›</Text></Pressable>
    <Pressable onPress={() => setLanguageTarget('recipient')} style={styles.languageRow}><Text style={styles.languageCaption}>{contact.displayName} hears</Text><Text style={styles.languageValue}>{recipientLanguage}  ›</Text></Pressable>
    <Pressable onPress={() => { const first = callerLanguage; setCallerLanguage(recipientLanguage); setRecipientLanguage(first); }} style={styles.swap}><Text style={styles.swapText}>Swap language direction ⇄</Text></Pressable>

    <Pressable disabled={creating} onPress={() => onStart({ callType, callerLanguage, recipientLanguage, voiceGender })} style={[styles.start, creating && styles.disabled]}><Text style={styles.startText}>{creating ? 'Starting…' : 'Start interpreted call'}</Text></Pressable>

    <Modal animationType="slide" onRequestClose={() => setLanguageTarget(null)} transparent visible={languageTarget !== null}>
      <View style={styles.backdrop}><Pressable onPress={() => setLanguageTarget(null)} style={StyleSheet.absoluteFill} /><View style={styles.sheet}><Text style={styles.sheetTitle}>Choose language</Text><ScrollView>{LANGUAGES.map((language) => <Pressable key={language} onPress={() => chooseLanguage(language)} style={styles.sheetRow}><Text style={styles.sheetText}>{language}</Text></Pressable>)}</ScrollView></View></View>
    </Modal>
  </View>;
}

function Choice({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#020713', flex: 1, paddingTop: 4 },
  setupHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  backButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  back: { color: BLUE, fontSize: 30, fontWeight: '500' },
  eyebrow: { color: BLUE, fontSize: 20, fontWeight: '800', letterSpacing: 0.2, marginTop: 4, textAlign: 'center' },
  title: { color: '#8BA6C9', fontSize: 13, fontWeight: '500', marginTop: 3, textAlign: 'center' },
  label: { color: '#8BA6C9', fontSize: 12, fontWeight: '800', letterSpacing: 1.1, marginBottom: 8, marginTop: 24, textTransform: 'uppercase' },
  segment: { backgroundColor: 'rgba(7,23,51,0.72)', borderColor: 'rgba(62,157,255,0.3)', borderRadius: 19, borderWidth: 1, flexDirection: 'row', gap: 6, padding: 5 },
  choice: { alignItems: 'center', borderRadius: 14, flex: 1, paddingHorizontal: 10, paddingVertical: 13 },
  choiceActive: { backgroundColor: '#075BFF', borderColor: '#19D7FF', borderWidth: 1, shadowColor: '#19D7FF', shadowOpacity: 0.5, shadowRadius: 12 },
  choiceText: { color: '#8BA6C9', fontSize: 14, fontWeight: '700' },
  choiceTextActive: { color: WHITE },
  languageRow: { alignItems: 'center', backgroundColor: 'rgba(7,23,51,0.72)', borderColor: 'rgba(62,157,255,0.3)', borderRadius: 17, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 9, minHeight: 58, paddingHorizontal: 16 },
  languageCaption: { color: '#8BA6C9', fontSize: 12, fontWeight: '600' },
  languageValue: { color: '#F8FBFF', fontSize: 15, fontWeight: '700' },
  swap: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  swapText: { color: '#75A9FF', fontSize: 13, fontWeight: '700' },
  start: { alignItems: 'center', backgroundColor: '#075BFF', borderColor: '#19D7FF', borderRadius: 24, borderWidth: 1, marginTop: 24, paddingVertical: 16, shadowColor: '#19D7FF', shadowOpacity: 0.5, shadowRadius: 15 },
  startText: { color: WHITE, fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  backdrop: { backgroundColor: 'rgba(0,4,12,0.72)', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#051126', borderColor: '#1D6FC5', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, maxHeight: '68%', padding: 22 },
  sheetTitle: { color: '#F8FBFF', fontSize: 23, fontWeight: '800', marginBottom: 10 },
  sheetRow: { borderBottomColor: '#152B4E', borderBottomWidth: 1, justifyContent: 'center', minHeight: 52 },
  sheetText: { color: '#F8FBFF', fontSize: 16 },
});
