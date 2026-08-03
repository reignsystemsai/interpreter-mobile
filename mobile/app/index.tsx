import { useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { AudioWaveform } from '../src/components/AudioWaveform';
import { useDemoAudioLevel } from '../src/hooks/useDemoAudioLevel';
import { useRealtimeInterpreter } from '../src/hooks/useRealtimeInterpreter';

const LANGUAGES = [
  'English',
  'Brazilian Portuguese',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Mandarin Chinese',
  'Japanese',
  'Korean',
  'Arabic',
  'Hindi',
] as const;

const LANGUAGE_LABELS: Record<string, string> = {
  'Brazilian Portuguese': 'Português (Brasil)',
  'Mandarin Chinese': '中文 (Mandarin)',
};

function languageLabel(language: string) {
  return LANGUAGE_LABELS[language] ?? language;
}

function GlobeIcon() {
  return (
    <Svg height={42} viewBox="0 0 48 48" width={42}>
      <Circle cx={24} cy={24} fill="none" r={19} stroke="#0A5BFF" strokeWidth={3} />
      <Path d="M5 24h38M24 5c6 5 9 11 9 19s-3 14-9 19M24 5c-6 5-9 11-9 19s3 14 9 19" fill="none" stroke="#0A5BFF" strokeWidth={2.4} />
    </Svg>
  );
}

function ChevronIcon() {
  return <Svg height={24} viewBox="0 0 24 24" width={24}><Path d="m5 8 7 7 7-7" fill="none" stroke="#0A5BFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} /></Svg>;
}

function MicrophoneIcon({ color = '#075BFF', muted = false }: { color?: string; muted?: boolean }) {
  return (
    <Svg height={30} viewBox="0 0 34 34" width={30}>
      <Path d="M12 8a5 5 0 0 1 10 0v9a5 5 0 0 1-10 0V8Z" fill={color} />
      <Path d="M7 16v1a10 10 0 0 0 20 0v-1M17 27v5M12 32h10" fill="none" stroke={color} strokeLinecap="round" strokeWidth={2.6} />
      {muted ? <Line stroke="#D92D20" strokeLinecap="round" strokeWidth={3} x1={6} x2={28} y1={6} y2={28} /> : null}
    </Svg>
  );
}

function ReplayIcon() {
  return <Svg height={29} viewBox="0 0 32 32" width={29}><Path d="M8 10V4l-5 5 5 5v-4a10 10 0 1 1-1 13" fill="none" stroke="#075BFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.7} /></Svg>;
}

function CloseIcon() {
  return <Svg height={26} viewBox="0 0 26 26" width={26}><Path d="M5 5l16 16M21 5 5 21" fill="none" stroke="#152238" strokeLinecap="round" strokeWidth={2.5} /></Svg>;
}

export default function InterpreterScreen() {
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [languageSheetOpen, setLanguageSheetOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const transcriptRef = useRef<ScrollView>(null);
  const targetLanguage = selectedLanguage ?? 'Spanish';
  const {
    detectedUserLanguage,
    errorMessage,
    isActive,
    isMuted,
    replayLastTranslation,
    start,
    status,
    stop,
    toggleMute,
    turns,
  } = useRealtimeInterpreter(targetLanguage);
  const audioLevel = useDemoAudioLevel(isActive);

  const statusText = useMemo(() => {
    if (status === 'connecting') return 'Connecting';
    if (status === 'translating') return 'Translating';
    if (status === 'speaking') return 'Speaking';
    if (status === 'error') return 'Connection interrupted';
    if (isActive) return 'Listening';
    return 'Ready';
  }, [isActive, status]);

  const beginConversation = async () => {
    if (!selectedLanguage) return;
    setConversationOpen(true);
    await start();
  };

  const endConversation = () => {
    stop();
    setConversationOpen(false);
  };

  return (
    <View style={styles.page}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        {conversationOpen ? (
          <View style={styles.conversationPage}>
            <View style={styles.conversationHeader}>
              <Pressable accessibilityLabel="End conversation" hitSlop={10} onPress={endConversation} style={styles.headerIcon}><CloseIcon /></Pressable>
              <View style={styles.headerTitleWrap}>
                <Text numberOfLines={1} style={styles.headerTitle}>{languageLabel(targetLanguage)}</Text>
                <Text style={styles.connectionText}>{statusText}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={endConversation} style={styles.endHeaderButton}><Text style={styles.endHeaderText}>End</Text></Pressable>
            </View>

            <View style={styles.livePanel}>
              <View style={[styles.liveOrb, status === 'speaking' && styles.liveOrbSpeaking]}>
                <AudioWaveform active={isActive} audioLevel={audioLevel} />
              </View>
              <Text accessibilityLiveRegion="polite" style={styles.liveStatus}>{statusText}</Text>
              <Text style={styles.directionText}>
                {detectedUserLanguage
                  ? `${detectedUserLanguage} ↔ ${languageLabel(targetLanguage)}`
                  : `Detecting your language ↔ ${languageLabel(targetLanguage)}`}
              </Text>
            </View>

            {errorMessage ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{errorMessage}</Text>
                <Pressable onPress={() => void start()} style={styles.reconnectButton}><Text style={styles.reconnectText}>Reconnect</Text></Pressable>
              </View>
            ) : null}

            <ScrollView
              contentContainerStyle={styles.transcriptContent}
              onContentSizeChange={() => transcriptRef.current?.scrollToEnd({ animated: true })}
              ref={transcriptRef}
              showsVerticalScrollIndicator={false}
              style={styles.transcriptList}
            >
              {turns.length === 0 ? (
                <View style={styles.emptyTranscript}>
                  <Text style={styles.emptyTitle}>Your conversation will appear here</Text>
                  <Text style={styles.emptyBody}>Speak naturally. Interpreter.ai detects your language and translates each turn.</Text>
                </View>
              ) : turns.map((turn) => (
                <View key={turn.id} style={styles.turnCard}>
                  <Text style={styles.turnLanguage}>{turn.originalLanguage}</Text>
                  <Text style={styles.originalText}>{turn.original || 'Listening…'}</Text>
                  <View style={styles.turnDivider} />
                  <Text style={styles.turnLanguage}>{turn.translationLanguage}</Text>
                  <Text style={styles.translationText}>{turn.translation || 'Translating…'}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.controls}>
              <ControlButton label={isMuted ? 'Unmute' : 'Mute'} onPress={toggleMute}><MicrophoneIcon muted={isMuted} /></ControlButton>
              <ControlButton disabled={!turns.some((turn) => turn.translation)} label="Replay" onPress={replayLastTranslation}><ReplayIcon /></ControlButton>
              <Pressable accessibilityRole="button" onPress={endConversation} style={styles.endButton}><Text style={styles.endButtonText}>End conversation</Text></Pressable>
            </View>
          </View>
        ) : (
          <ScrollView bounces={false} contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
            <View style={styles.topBar}>
              <Image resizeMode="contain" source={require('../assets/interpreter-mark.png')} style={styles.smallLogo} />
              <Text style={styles.smallWordmark}>interpreter.ai</Text>
              <Pressable accessibilityLabel="About Interpreter.ai" hitSlop={12} onPress={() => setInfoOpen(true)} style={styles.infoButton}><Text style={styles.infoText}>i</Text></Pressable>
            </View>

            <View style={styles.hero}>
              <Image resizeMode="contain" source={require('../assets/interpreter-mark.png')} style={styles.heroLogo} />
              <Text adjustsFontSizeToFit numberOfLines={1} style={styles.wordmark}>interpreter.ai</Text>
              <Text style={styles.tagline}>Speak any language.</Text>
            </View>

            <Pressable accessibilityHint="Opens language choices" accessibilityRole="button" onPress={() => setLanguageSheetOpen(true)} style={({ pressed }) => [styles.languageCard, pressed && styles.pressed]}>
              <GlobeIcon />
              <View style={styles.languageText}>
                <Text style={styles.languageLabel}>Language to interpret</Text>
                <Text numberOfLines={1} style={[styles.languageValue, !selectedLanguage && styles.placeholder]}>{selectedLanguage ? languageLabel(selectedLanguage) : 'Choose a language'}</Text>
              </View>
              <ChevronIcon />
            </Pressable>

            <Text style={styles.supportText}>We’ll automatically detect the language you speak and interpret both sides of the conversation.</Text>

            <Pressable accessibilityRole="button" disabled={!selectedLanguage} onPress={() => void beginConversation()} style={({ pressed }) => [styles.startButton, !selectedLanguage && styles.startDisabled, pressed && selectedLanguage && styles.pressed]}>
              <LinearGradient colors={['#0A73FF', '#0848F4']} end={{ x: 1, y: 0.5 }} start={{ x: 0, y: 0.5 }} style={styles.startGradient}>
                <MicrophoneIcon color="#FFFFFF" />
                <Text style={styles.startText}>Start Conversation</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>

      <LanguageSheet onClose={() => setLanguageSheetOpen(false)} onSelect={(language) => { setSelectedLanguage(language); setLanguageSheetOpen(false); }} selectedLanguage={selectedLanguage} visible={languageSheetOpen} />
      <Modal animationType="fade" onRequestClose={() => setInfoOpen(false)} transparent visible={infoOpen}>
        <Pressable onPress={() => setInfoOpen(false)} style={styles.modalBackdrop}>
          <Pressable onPress={() => undefined} style={styles.infoCard}>
            <Image resizeMode="contain" source={require('../assets/interpreter-mark.png')} style={styles.infoLogo} />
            <Text style={styles.infoTitle}>Interpreter.ai</Text>
            <Text style={styles.infoBody}>Live, automatic two-way voice interpretation. Select the language you want to hear, then speak naturally.</Text>
            <Pressable onPress={() => setInfoOpen(false)} style={styles.doneButton}><Text style={styles.doneText}>Done</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ControlButton({ children, disabled, label, onPress }: { children: React.ReactNode; disabled?: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.controlButton, disabled && styles.controlDisabled]}><View style={styles.controlIcon}>{children}</View><Text style={styles.controlLabel}>{label}</Text></Pressable>;
}

function LanguageSheet({ onClose, onSelect, selectedLanguage, visible }: { onClose: () => void; onSelect: (language: string) => void; selectedLanguage: string | null; visible: boolean }) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable accessibilityViewIsModal onPress={() => undefined} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Language to interpret</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {LANGUAGES.map((language) => (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedLanguage === language }} key={language} onPress={() => onSelect(language)} style={[styles.languageOption, selectedLanguage === language && styles.languageOptionSelected]}>
                <Text style={styles.languageOptionText}>{languageLabel(language)}</Text>
                {selectedLanguage === language ? <Text style={styles.checkmark}>✓</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#F8FBFF', flex: 1 },
  safeArea: { flex: 1 },
  homeContent: { flexGrow: 1, paddingBottom: 28, paddingHorizontal: 26 },
  topBar: { alignItems: 'center', flexDirection: 'row', height: 62 },
  smallLogo: { height: 38, width: 38 },
  smallWordmark: { color: '#075BFF', fontSize: 22, fontWeight: '700', marginLeft: 8 },
  infoButton: { alignItems: 'center', borderColor: '#0A5BFF', borderRadius: 17, borderWidth: 2, height: 34, justifyContent: 'center', marginLeft: 'auto', width: 34 },
  infoText: { color: '#0A5BFF', fontFamily: 'serif', fontSize: 23, fontWeight: '800', lineHeight: 26 },
  hero: { alignItems: 'center', marginTop: 36 },
  heroLogo: { height: 132, width: 132 },
  wordmark: { color: '#075BFF', fontSize: 48, fontWeight: '800', letterSpacing: -2, marginTop: 10, maxWidth: '100%' },
  tagline: { color: '#68758A', fontSize: 21, marginTop: 10 },
  languageCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 30, flexDirection: 'row', marginTop: 48, minHeight: 98, paddingHorizontal: 23, shadowColor: '#075BFF', shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.12, shadowRadius: 22 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.988 }] },
  languageText: { flex: 1, marginHorizontal: 18 },
  languageLabel: { color: '#67758D', fontSize: 15 },
  languageValue: { color: '#101828', fontSize: 23, marginTop: 5 },
  placeholder: { color: '#98A2B3' },
  supportText: { color: '#667085', fontSize: 14, lineHeight: 21, marginHorizontal: 14, marginTop: 22, textAlign: 'center' },
  startButton: { borderRadius: 34, marginTop: 'auto', overflow: 'hidden', shadowColor: '#075BFF', shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.22, shadowRadius: 18 },
  startDisabled: { opacity: 0.42 },
  startGradient: { alignItems: 'center', flexDirection: 'row', height: 70, justifyContent: 'center' },
  startText: { color: '#FFFFFF', fontSize: 21, fontWeight: '600', marginLeft: 15 },
  conversationPage: { flex: 1, paddingHorizontal: 18 },
  conversationHeader: { alignItems: 'center', borderBottomColor: '#E7ECF4', borderBottomWidth: 1, flexDirection: 'row', minHeight: 66 },
  headerIcon: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  headerTitleWrap: { flex: 1, marginHorizontal: 8 },
  headerTitle: { color: '#101828', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  connectionText: { color: '#0A5BFF', fontSize: 12, marginTop: 2, textAlign: 'center' },
  endHeaderButton: { paddingHorizontal: 8, paddingVertical: 10 },
  endHeaderText: { color: '#D92D20', fontSize: 16, fontWeight: '700' },
  livePanel: { alignItems: 'center', paddingBottom: 16, paddingTop: 22 },
  liveOrb: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#DCE8FF', borderRadius: 56, borderWidth: 2, height: 112, justifyContent: 'center', shadowColor: '#075BFF', shadowOpacity: 0.12, shadowRadius: 18, width: 112 },
  liveOrbSpeaking: { borderColor: '#0A5BFF', shadowOpacity: 0.24 },
  liveStatus: { color: '#101828', fontSize: 20, fontWeight: '700', marginTop: 14 },
  directionText: { color: '#667085', fontSize: 13, marginTop: 5, textAlign: 'center' },
  errorCard: { alignItems: 'center', backgroundColor: '#FFF1F0', borderRadius: 15, flexDirection: 'row', marginBottom: 10, padding: 12 },
  errorText: { color: '#B42318', flex: 1, fontSize: 13, lineHeight: 18 },
  reconnectButton: { backgroundColor: '#FFFFFF', borderRadius: 10, marginLeft: 10, paddingHorizontal: 12, paddingVertical: 8 },
  reconnectText: { color: '#075BFF', fontSize: 13, fontWeight: '700' },
  transcriptList: { flex: 1 },
  transcriptContent: { paddingBottom: 12 },
  emptyTranscript: { alignItems: 'center', paddingHorizontal: 30, paddingTop: 34 },
  emptyTitle: { color: '#344054', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  emptyBody: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  turnCard: { backgroundColor: '#FFFFFF', borderColor: '#E4EBF7', borderRadius: 20, borderWidth: 1, marginBottom: 12, padding: 17 },
  turnLanguage: { color: '#075BFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  originalText: { color: '#344054', fontSize: 16, lineHeight: 23, marginTop: 6 },
  turnDivider: { backgroundColor: '#EDF1F7', height: 1, marginVertical: 13 },
  translationText: { color: '#101828', fontSize: 17, fontWeight: '600', lineHeight: 24, marginTop: 6 },
  controls: { alignItems: 'center', borderTopColor: '#E7ECF4', borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingBottom: 8, paddingTop: 12 },
  controlButton: { alignItems: 'center', minWidth: 60, padding: 6 },
  controlDisabled: { opacity: 0.35 },
  controlIcon: { color: '#075BFF', height: 32 },
  controlLabel: { color: '#475467', fontSize: 11, marginTop: 3 },
  endButton: { alignItems: 'center', backgroundColor: '#D92D20', borderRadius: 24, flex: 1, height: 48, justifyContent: 'center', marginLeft: 4 },
  endButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(10, 20, 40, 0.3)', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 30, borderTopRightRadius: 30, maxHeight: '78%', paddingBottom: 24, paddingHorizontal: 22, paddingTop: 12, width: '100%' },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#D0D5DD', borderRadius: 3, height: 5, marginBottom: 18, width: 44 },
  sheetTitle: { color: '#101828', fontSize: 23, fontWeight: '700', marginBottom: 12 },
  languageOption: { alignItems: 'center', borderRadius: 15, flexDirection: 'row', minHeight: 56, paddingHorizontal: 16 },
  languageOptionSelected: { backgroundColor: '#EEF4FF' },
  languageOptionText: { color: '#101828', flex: 1, fontSize: 17 },
  checkmark: { color: '#075BFF', fontSize: 22, fontWeight: '800' },
  infoCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 28, marginBottom: 'auto', marginHorizontal: 24, marginTop: 'auto', padding: 28, width: '86%' },
  infoLogo: { height: 88, width: 88 },
  infoTitle: { color: '#075BFF', fontSize: 28, fontWeight: '800', marginTop: 10 },
  infoBody: { color: '#475467', fontSize: 15, lineHeight: 22, marginTop: 12, textAlign: 'center' },
  doneButton: { backgroundColor: '#075BFF', borderRadius: 20, marginTop: 24, paddingHorizontal: 30, paddingVertical: 12 },
  doneText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
