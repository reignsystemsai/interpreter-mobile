import { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
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
  'Spanish',
  'Brazilian Portuguese',
  'French',
  'German',
  'Italian',
  'Dutch',
  'Russian',
  'Polish',
  'Romanian',
  'Turkish',
  'Arabic',
  'Hebrew',
  'Hindi',
  'Japanese',
  'Korean',
  'Mandarin Chinese',
  'Cantonese',
  'Vietnamese',
  'Thai',
] as const;

const LANGUAGE_LABELS: Record<string, string> = {
  'Brazilian Portuguese': 'Portuguese (Brazil)',
};

type Overlay = 'settings' | 'languages' | 'privacy' | 'about' | null;

function languageLabel(language: string) {
  return LANGUAGE_LABELS[language] ?? language;
}

function MenuIcon() {
  return (
    <Svg height={31} viewBox="0 0 32 32" width={31}>
      {[7, 16, 25].map((y) => (
        <Line key={y} stroke="#075BFF" strokeLinecap="round" strokeWidth={3} x1={5} x2={27} y1={y} y2={y} />
      ))}
    </Svg>
  );
}

function GlobeIcon() {
  return (
    <Svg height={42} viewBox="0 0 48 48" width={42}>
      <Circle cx={24} cy={24} fill="none" r={19} stroke="#075BFF" strokeWidth={3} />
      <Path d="M5 24h38M24 5c6 5 9 11 9 19s-3 14-9 19M24 5c-6 5-9 11-9 19s3 14 9 19" fill="none" stroke="#075BFF" strokeWidth={2.4} />
    </Svg>
  );
}

function ChevronIcon({ right = false }: { right?: boolean }) {
  const path = right ? 'm9 5 7 7-7 7' : 'm5 8 7 7 7-7';
  return <Svg height={24} viewBox="0 0 24 24" width={24}><Path d={path} fill="none" stroke="#075BFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.8} /></Svg>;
}

function MicrophoneIcon({ ending }: { ending: boolean }) {
  return (
    <Svg height={32} viewBox="0 0 34 34" width={32}>
      {ending ? (
        <Path d="M10 10h14v14H10z" fill="#FFFFFF" />
      ) : (
        <>
          <Path d="M12 8a5 5 0 0 1 10 0v9a5 5 0 0 1-10 0V8Z" fill="#FFFFFF" />
          <Path d="M7 16v1a10 10 0 0 0 20 0v-1M17 27v5M12 32h10" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeWidth={2.6} />
        </>
      )}
    </Svg>
  );
}

export default function InterpreterScreen() {
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const targetLanguage = selectedLanguage ?? 'Spanish';
  const { isActive, start, status, stop, turns } =
    useRealtimeInterpreter(targetLanguage);
  const audioLevel = useDemoAudioLevel(isActive);
  const latestTurn = turns.at(-1);

  const statusText = useMemo(() => {
    if (status === 'connecting') return 'Connecting...';
    if (status === 'detecting') return 'Detecting language...';
    if (status === 'translating') return 'Translating...';
    if (status === 'speaking') return 'Speaking...';
    if (status === 'error') return 'Reconnecting...';
    if (isActive) return 'Listening...';
    return 'Ready';
  }, [isActive, status]);

  const toggleConversation = () => {
    if (isActive || status === 'connecting' || status === 'error') stop();
    else if (selectedLanguage) void start();
  };

  const foreground = darkMode ? '#F8FAFF' : '#101828';
  const secondary = darkMode ? '#AAB6CC' : '#68758A';
  const surface = darkMode ? '#182236' : '#FFFFFF';

  return (
    <View style={[styles.page, darkMode && styles.pageDark]}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <ScrollView
          bounces={false}
          contentContainerStyle={[styles.content, compact && styles.contentCompact]}
          scrollEnabled={compact || showTranscript}
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => setOverlay('settings')}
            style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
          >
            <MenuIcon />
          </Pressable>

          <View style={[styles.hero, compact && styles.heroCompact]}>
            <Image resizeMode="contain" source={require('../assets/interpreter-mark.png')} style={[styles.logo, compact && styles.logoCompact]} />
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.wordmark}>interpreter.ai</Text>
            <Text style={[styles.tagline, { color: secondary }]}>Speak any language.</Text>
          </View>

          <Pressable
            accessibilityHint="Opens language choices"
            accessibilityLabel={`Language to interpret to: ${selectedLanguage ? languageLabel(selectedLanguage) : 'not selected'}`}
            accessibilityRole="button"
            disabled={isActive || status === 'connecting'}
            onPress={() => setOverlay('languages')}
            style={({ pressed }) => [
              styles.languageCard,
              compact && styles.languageCardCompact,
              { backgroundColor: surface },
              pressed && styles.pressed,
              (isActive || status === 'connecting') && styles.disabled,
            ]}
          >
            <GlobeIcon />
            <View style={styles.languageText}>
              <Text style={[styles.languageLabel, { color: secondary }]}>Language to interpret to</Text>
              <Text numberOfLines={1} style={[styles.languageValue, { color: foreground }, !selectedLanguage && styles.placeholder]}>
                {selectedLanguage ? languageLabel(selectedLanguage) : 'Choose a language'}
              </Text>
            </View>
            <ChevronIcon />
          </Pressable>

          <View style={[styles.orbWrap, compact && styles.orbWrapCompact]}>
            <View style={[styles.orbGlow, compact && styles.orbGlowCompact]} />
            <View style={[styles.orb, compact && styles.orbCompact, { backgroundColor: surface }]}>
              <View style={[styles.dottedRing, compact && styles.dottedRingCompact]}>
                <AudioWaveform active={isActive} audioLevel={audioLevel} />
                <Text accessibilityLiveRegion="polite" numberOfLines={2} style={[styles.statusText, { color: foreground }]}>{statusText}</Text>
              </View>
            </View>
          </View>

          {showTranscript && latestTurn ? (
            <View style={[styles.transcriptPanel, { backgroundColor: surface }]}>
              <Text style={[styles.transcriptLabel, { color: secondary }]}>{latestTurn.originalLanguage}</Text>
              <Text style={[styles.transcriptText, { color: foreground }]}>{latestTurn.original}</Text>
              <View style={styles.transcriptDivider} />
              <Text style={[styles.transcriptLabel, { color: secondary }]}>{latestTurn.translationLanguage}</Text>
              <Text style={[styles.transcriptText, { color: foreground }]}>{latestTurn.translation || 'Translating...'}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityLabel={isActive ? 'End conversation' : 'Start conversation'}
            accessibilityRole="button"
            disabled={!selectedLanguage && !isActive}
            onPress={toggleConversation}
            style={({ pressed }) => [styles.startButton, !selectedLanguage && !isActive && styles.startDisabled, pressed && styles.pressed]}
          >
            <LinearGradient
              colors={isActive || status === 'connecting' || status === 'error' ? ['#334155', '#1F2937'] : ['#0A73FF', '#0848F4']}
              end={{ x: 1, y: 0.5 }}
              start={{ x: 0, y: 0.5 }}
              style={styles.startGradient}
            >
              <MicrophoneIcon ending={isActive || status === 'connecting' || status === 'error'} />
              <Text style={styles.startText}>{isActive || status === 'connecting' || status === 'error' ? 'End Conversation' : 'Start Conversation'}</Text>
            </LinearGradient>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <SettingsSheet
        darkMode={darkMode}
        onClose={() => setOverlay(null)}
        onDarkModeChange={setDarkMode}
        onNavigate={setOverlay}
        onTranscriptChange={setShowTranscript}
        showTranscript={showTranscript}
        visible={overlay === 'settings'}
      />
      <LanguageSheet
        darkMode={darkMode}
        onClose={() => setOverlay(null)}
        onSelect={(language) => { setSelectedLanguage(language); setOverlay(null); }}
        selectedLanguage={selectedLanguage}
        visible={overlay === 'languages'}
      />
      <InformationSheet darkMode={darkMode} kind="privacy" onClose={() => setOverlay('settings')} visible={overlay === 'privacy'} />
      <InformationSheet darkMode={darkMode} kind="about" onClose={() => setOverlay('settings')} visible={overlay === 'about'} />
    </View>
  );
}

function SettingsSheet({ darkMode, onClose, onDarkModeChange, onNavigate, onTranscriptChange, showTranscript, visible }: {
  darkMode: boolean;
  onClose: () => void;
  onDarkModeChange: (value: boolean) => void;
  onNavigate: (value: Overlay) => void;
  onTranscriptChange: (value: boolean) => void;
  showTranscript: boolean;
  visible: boolean;
}) {
  const surface = darkMode ? '#182236' : '#FFFFFF';
  const foreground = darkMode ? '#F8FAFF' : '#101828';
  const secondary = darkMode ? '#AAB6CC' : '#667085';
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable accessibilityViewIsModal onPress={() => undefined} style={[styles.sheet, { backgroundColor: surface }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: foreground }]}>Settings</Text>
          <SettingsLink label="Languages" onPress={() => onNavigate('languages')} value="20 supported" foreground={foreground} secondary={secondary} />
          <SettingsLink label="Voice" value="Alloy" foreground={foreground} secondary={secondary} />
          <SettingsToggle label="Dark Mode" value={darkMode} onChange={onDarkModeChange} foreground={foreground} />
          <SettingsToggle label="Show Transcript" value={showTranscript} onChange={onTranscriptChange} foreground={foreground} />
          <SettingsLink label="Save Conversations" value="Off" foreground={foreground} secondary={secondary} />
          <SettingsLink label="Privacy" onPress={() => onNavigate('privacy')} foreground={foreground} secondary={secondary} />
          <SettingsLink label="About" onPress={() => onNavigate('about')} foreground={foreground} secondary={secondary} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SettingsLink({ foreground, label, onPress, secondary, value }: { foreground: string; label: string; onPress?: () => void; secondary: string; value?: string }) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.settingsRow, pressed && onPress && styles.pressed]}>
      <Text style={[styles.settingsLabel, { color: foreground }]}>{label}</Text>
      {value ? <Text style={[styles.settingsValue, { color: secondary }]}>{value}</Text> : null}
      {onPress ? <ChevronIcon right /> : null}
    </Pressable>
  );
}

function SettingsToggle({ foreground, label, onChange, value }: { foreground: string; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return (
    <View style={styles.settingsRow}>
      <Text style={[styles.settingsLabel, { color: foreground }]}>{label}</Text>
      <Switch ios_backgroundColor="#CBD5E1" onValueChange={onChange} thumbColor="#FFFFFF" trackColor={{ false: '#CBD5E1', true: '#075BFF' }} value={value} />
    </View>
  );
}

function LanguageSheet({ darkMode, onClose, onSelect, selectedLanguage, visible }: { darkMode: boolean; onClose: () => void; onSelect: (language: string) => void; selectedLanguage: string | null; visible: boolean }) {
  const surface = darkMode ? '#182236' : '#FFFFFF';
  const foreground = darkMode ? '#F8FAFF' : '#101828';
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable accessibilityViewIsModal onPress={() => undefined} style={[styles.sheet, { backgroundColor: surface }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: foreground }]}>Language to interpret to</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {LANGUAGES.map((language) => (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedLanguage === language }} key={language} onPress={() => onSelect(language)} style={[styles.languageOption, selectedLanguage === language && styles.languageOptionSelected]}>
                <Text style={[styles.languageOptionText, { color: foreground }]}>{languageLabel(language)}</Text>
                {selectedLanguage === language ? <Text style={styles.checkmark}>✓</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function InformationSheet({ darkMode, kind, onClose, visible }: { darkMode: boolean; kind: 'privacy' | 'about'; onClose: () => void; visible: boolean }) {
  const surface = darkMode ? '#182236' : '#FFFFFF';
  const foreground = darkMode ? '#F8FAFF' : '#101828';
  const body = kind === 'privacy'
    ? 'Interpreter.ai sends live microphone audio directly to OpenAI through a secure, short-lived Realtime session. The app does not save conversations by default, and the permanent API key never leaves the server.'
    : 'Interpreter.ai is a live two-way voice interpreter. Select one output language, tap Start Conversation, and let both people speak naturally.';
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable accessibilityViewIsModal onPress={() => undefined} style={[styles.infoSheet, { backgroundColor: surface }]}>
          <Image resizeMode="contain" source={require('../assets/interpreter-mark.png')} style={styles.infoLogo} />
          <Text style={[styles.infoTitle, { color: foreground }]}>{kind === 'privacy' ? 'Privacy' : 'About Interpreter.ai'}</Text>
          <Text style={[styles.infoBody, { color: darkMode ? '#AAB6CC' : '#475467' }]}>{body}</Text>
          <Pressable onPress={onClose} style={styles.doneButton}><Text style={styles.doneText}>Done</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#FFFFFF', flex: 1 },
  pageDark: { backgroundColor: '#0C1423' },
  safeArea: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 22, paddingHorizontal: 28 },
  contentCompact: { paddingBottom: 14, paddingHorizontal: 22 },
  menuButton: { alignItems: 'center', height: 48, justifyContent: 'center', position: 'absolute', right: 24, top: 8, width: 48, zIndex: 2 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.58 },
  hero: { alignItems: 'center', marginTop: 36 },
  heroCompact: { marginTop: 18 },
  logo: { height: 112, width: 112 },
  logoCompact: { height: 86, width: 86 },
  wordmark: { color: '#075BFF', fontSize: 48, fontWeight: '800', letterSpacing: -2, marginTop: 5, maxWidth: '100%' },
  tagline: { fontSize: 20, marginTop: 7 },
  languageCard: { alignItems: 'center', alignSelf: 'center', borderRadius: 32, flexDirection: 'row', marginTop: 35, maxWidth: 480, minHeight: 94, paddingHorizontal: 23, shadowColor: '#075BFF', shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.12, shadowRadius: 22, width: '100%' },
  languageCardCompact: { marginTop: 22, minHeight: 82 },
  languageText: { flex: 1, marginHorizontal: 18 },
  languageLabel: { fontSize: 14 },
  languageValue: { fontSize: 23, marginTop: 5 },
  placeholder: { color: '#98A2B3' },
  orbWrap: { alignItems: 'center', alignSelf: 'center', height: 286, justifyContent: 'center', marginTop: 27, width: 286 },
  orbWrapCompact: { height: 224, marginTop: 18, width: 224 },
  orbGlow: { backgroundColor: '#F7FAFF', borderRadius: 143, height: 286, position: 'absolute', shadowColor: '#075BFF', shadowOpacity: 0.18, shadowRadius: 28, width: 286 },
  orbGlowCompact: { borderRadius: 112, height: 224, width: 224 },
  orb: { alignItems: 'center', borderColor: '#F0F5FF', borderRadius: 130, borderWidth: 9, height: 260, justifyContent: 'center', width: 260 },
  orbCompact: { borderRadius: 102, borderWidth: 8, height: 204, width: 204 },
  dottedRing: { alignItems: 'center', borderColor: '#075BFF', borderRadius: 114, borderStyle: 'dotted', borderWidth: 2.5, height: 228, justifyContent: 'center', width: 228 },
  dottedRingCompact: { borderRadius: 88, height: 176, width: 176 },
  statusText: { fontSize: 17, lineHeight: 22, marginTop: 12, maxWidth: 185, textAlign: 'center' },
  transcriptPanel: { alignSelf: 'center', borderRadius: 18, marginBottom: 12, maxWidth: 480, padding: 15, shadowColor: '#075BFF', shadowOpacity: 0.08, shadowRadius: 14, width: '100%' },
  transcriptLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  transcriptText: { fontSize: 14, lineHeight: 20, marginTop: 3 },
  transcriptDivider: { backgroundColor: '#E7ECF4', height: 1, marginVertical: 9 },
  startButton: { alignSelf: 'center', borderRadius: 34, marginTop: 'auto', maxWidth: 480, overflow: 'hidden', shadowColor: '#075BFF', shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.23, shadowRadius: 18, width: '100%' },
  startDisabled: { opacity: 0.4 },
  startGradient: { alignItems: 'center', flexDirection: 'row', height: 68, justifyContent: 'center', paddingHorizontal: 18 },
  startText: { color: '#FFFFFF', fontSize: 20, fontWeight: '600', marginLeft: 15 },
  modalBackdrop: { backgroundColor: 'rgba(8, 18, 38, 0.32)', flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, maxHeight: '82%', paddingBottom: 26, paddingHorizontal: 22, paddingTop: 12 },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#CBD5E1', borderRadius: 3, height: 5, marginBottom: 18, width: 44 },
  sheetTitle: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  settingsRow: { alignItems: 'center', borderBottomColor: 'rgba(148, 163, 184, 0.2)', borderBottomWidth: 1, flexDirection: 'row', minHeight: 58, paddingHorizontal: 4 },
  settingsLabel: { flex: 1, fontSize: 17 },
  settingsValue: { fontSize: 14, marginRight: 7 },
  languageOption: { alignItems: 'center', borderRadius: 15, flexDirection: 'row', minHeight: 52, paddingHorizontal: 15 },
  languageOptionSelected: { backgroundColor: 'rgba(7, 91, 255, 0.1)' },
  languageOptionText: { flex: 1, fontSize: 17 },
  checkmark: { color: '#075BFF', fontSize: 22, fontWeight: '800' },
  infoSheet: { alignItems: 'center', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingBottom: 34, paddingHorizontal: 28, paddingTop: 24 },
  infoLogo: { height: 78, width: 78 },
  infoTitle: { fontSize: 25, fontWeight: '800', marginTop: 10 },
  infoBody: { fontSize: 15, lineHeight: 22, marginTop: 13, textAlign: 'center' },
  doneButton: { backgroundColor: '#075BFF', borderRadius: 20, marginTop: 22, paddingHorizontal: 30, paddingVertical: 12 },
  doneText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
