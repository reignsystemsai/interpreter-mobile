import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AudioWaveform } from '../src/components/AudioWaveform';
import { useDemoAudioLevel } from '../src/hooks/useDemoAudioLevel';
import { useRealtimeInterpreter } from '../src/hooks/useRealtimeInterpreter';
import { recordAppReady } from '../src/services/performance';
import { CallingOverlay } from '../src/features/calling/CallingOverlay';
import { VoiceCallService } from '../src/features/calling/VoiceCallService';
import { useAuth } from '../src/features/account/AuthProvider';
import { AppMenu, type MenuDestination } from '../src/features/menu/AppMenu';
import { DestinationSheet } from '../src/features/menu/DestinationSheet';
import { useLanguagePreferences } from '../src/features/languages/LanguagePreferencesProvider';

const LANGUAGES = [
  'English', 'Spanish', 'Brazilian Portuguese', 'French', 'German', 'Italian',
  'Dutch', 'Russian', 'Polish', 'Romanian', 'Turkish', 'Arabic', 'Hebrew',
  'Hindi', 'Japanese', 'Korean', 'Mandarin Chinese', 'Cantonese', 'Vietnamese', 'Thai',
] as const;

const LANGUAGE_LABELS: Record<string, string> = {
  'Brazilian Portuguese': 'Portuguese (Brazil)',
  'Mandarin Chinese': 'Mandarin',
};

type Gender = 'female' | 'male';
type LanguageSide = 'one' | 'two';
type Overlay = 'menu' | 'language' | 'calling' | MenuDestination | null;

const PINK = '#FF3E91';
const BLUE = '#075BFF';

function languageLabel(language: string) {
  return LANGUAGE_LABELS[language] ?? language;
}

function MenuIcon() {
  return <Svg height={30} viewBox="0 0 32 32" width={30}>{[7, 16, 25].map((y) => <Line key={y} stroke={BLUE} strokeLinecap="round" strokeWidth={3} x1={5} x2={27} y1={y} y2={y} />)}</Svg>;
}

function PhoneIcon() {
  return <Svg height={29} viewBox="0 0 32 32" width={29}><Path d="M8.2 4.8 12 4l3.1 7.1-2.8 2.2c1.6 3.2 4.1 5.7 7.3 7.3l2.2-2.8L29 21l-.8 3.8c-.4 2-2.2 3.4-4.3 3.2C13.4 27 5 18.6 4 8.1 3.8 6 5.2 4.2 7.2 3.8" fill="none" stroke={BLUE} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} /></Svg>;
}

function GlobeIcon({ color }: { color: string }) {
  return (
    <Svg height={22} viewBox="0 0 28 28" width={22}>
      <Circle cx={14} cy={14} fill="none" r={10.5} stroke={color} strokeWidth={1.8} />
      <Path d="M3.5 14h21M14 3.5c3.5 3 5 6.4 5 10.5s-1.5 7.5-5 10.5M14 3.5c-3.5 3-5 6.4-5 10.5s1.5 7.5 5 10.5" fill="none" stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

function ChevronIcon({ color = BLUE, right = false }: { color?: string; right?: boolean }) {
  return <Svg height={19} viewBox="0 0 24 24" width={19}><Path d={right ? 'm9 5 7 7-7 7' : 'm6 9 6 6 6-6'} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.8} /></Svg>;
}

function DirectionArrow({ color }: { color: string }) {
  return <Svg height={25} viewBox="0 0 32 24" width={31}><Path d="M3 12h23M20 5l7 7-7 7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} /></Svg>;
}

function SpeakerIcon({ color, gender }: { color: string; gender: Gender }) {
  return (
    <Svg height={48} viewBox="0 0 48 48" width={48}>
      <Circle cx={24} cy={24} fill={`${color}12`} r={22} stroke={`${color}33`} strokeWidth={1.5} />
      <Circle cx={24} cy={18} fill={color} r={7} />
      {gender === 'female' ? (
        <Path d="M16 17c0-7 3-11 8-11s8 4 8 11v7c0 3 2 5 5 7-3 2-7 3-13 3s-10-1-13-3c3-2 5-4 5-7v-7Zm-5 24c1-7 5-11 13-11s12 4 13 11" fill={color} />
      ) : (
        <Path d="M14 42c1-9 4-14 10-14s9 5 10 14H14ZM17 11c2-4 5-6 9-5 4 1 6 4 6 8-4-2-9-2-15-3Z" fill={color} />
      )}
    </Svg>
  );
}

function MicrophoneIcon({ ending }: { ending: boolean }) {
  return (
    <Svg height={31} viewBox="0 0 34 34" width={31}>
      {ending ? <Path d="M10 10h14v14H10z" fill="#FFFFFF" /> : <><Path d="M12 8a5 5 0 0 1 10 0v9a5 5 0 0 1-10 0V8Z" fill="#FFFFFF" /><Path d="M7 16v1a10 10 0 0 0 20 0v-1M17 27v5M12 32h10" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeWidth={2.6} /></>}
    </Svg>
  );
}

function ListeningOrb({ hearingSpeech, statusText, compact }: { hearingSpeech: boolean; statusText: string; compact: boolean }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = hearingSpeech ? withTiming(1, { duration: 120 }) : withRepeat(withTiming(1.035, { duration: 1100 }), -1, true);
  }, [hearingSpeech, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const audioLevel = useDemoAudioLevel(hearingSpeech);
  return (
    <View style={[styles.orbWrap, compact && styles.orbWrapCompact]}>
      <View style={[styles.orbGlow, compact && styles.orbGlowCompact]} />
      <Animated.View style={[styles.orb, compact && styles.orbCompact, pulseStyle]}>
        <View style={[styles.dottedRing, compact && styles.dottedRingCompact]}>
          <AudioWaveform active={hearingSpeech} audioLevel={audioLevel} />
          <Text accessibilityLiveRegion="polite" style={styles.statusText}>{statusText}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

export default function InterpreterScreen() {
  const { height } = useWindowDimensions();
  const compact = height < 780;
  const { languageOne, languageTwo, setLanguageOne, setLanguageTwo } = useLanguagePreferences();
  const [genderOne, setGenderOne] = useState<Gender>('female');
  const [genderTwo, setGenderTwo] = useState<Gender>('male');
  const [languageSide, setLanguageSide] = useState<LanguageSide>('one');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const { recoveryMode } = useAuth();
  const { errorMessage, isActive, start, status, stop } = useRealtimeInterpreter(languageOne, languageTwo);

  useEffect(() => {
    recordAppReady();
  }, []);

  useEffect(() => {
    if (recoveryMode) setOverlay('account');
  }, [recoveryMode]);

  const statusText = useMemo(() => {
    if (['requesting_permission', 'creating_session', 'connecting', 'connected'].includes(status)) return 'Connecting...';
    if (status === 'reconnecting') return 'Reconnecting...';
    if (status === 'failed' || status === 'disconnected') return 'Couldn’t Connect';
    if (status === 'detecting' || status === 'listening') return 'Listening...';
    if (status === 'translating' || status === 'speaking') return 'Translating...';
    if (isActive) return 'Ready';
    return 'Ready';
  }, [isActive, status]);

  const conversationRunning = isActive || ['requesting_permission', 'creating_session', 'connecting', 'connected', 'reconnecting'].includes(status);
  useEffect(() => VoiceCallService.subscribe((callState) => {
    if (callState.role !== 'recipient' || callState.status !== 'ringing') return;
    setOverlay(null);
    if (status === 'failed' || conversationRunning) stop();
  }), [conversationRunning, status, stop]);
  const openLanguage = (side: LanguageSide) => {
    if (conversationRunning) return;
    setLanguageSide(side);
    setOverlay('language');
  };
  const chooseLanguage = (language: string) => {
    if (languageSide === 'one') {
      if (language === languageTwo) setLanguageTwo(languageOne);
      setLanguageOne(language);
    } else {
      if (language === languageOne) setLanguageOne(languageTwo);
      setLanguageTwo(language);
    }
    setOverlay(null);
  };
  const toggleConversation = () => {
    if (conversationRunning) stop();
    else void start();
  };

  return (
    <View style={styles.page}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <ScrollView bounces={false} contentContainerStyle={[styles.content, compact && styles.contentCompact]} scrollEnabled={compact} showsVerticalScrollIndicator={false}>
          <Pressable accessibilityLabel="Open calling" accessibilityRole="button" disabled={conversationRunning} hitSlop={12} onPress={() => setOverlay('calling')} style={({ pressed }) => [styles.phoneButton, conversationRunning && styles.disabled, pressed && styles.pressed]}><PhoneIcon /></Pressable>
          <Pressable accessibilityLabel="Open menu" accessibilityRole="button" hitSlop={12} onPress={() => setOverlay('menu')} style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}><MenuIcon /></Pressable>

          <View style={[styles.hero, compact && styles.heroCompact]}>
            <Image resizeMode="contain" source={require('../assets/interpreter-bubble.png')} style={[styles.logo, compact && styles.logoCompact]} />
            <Text style={styles.wordmark}>interpreter</Text>
            <Text style={styles.tagline}>Speak any language.</Text>
          </View>

          <ListeningOrb compact={compact} hearingSpeech={status === 'detecting'} statusText={statusText} />

          <View style={[styles.rows, compact && styles.rowsCompact]}>
            <DirectionRow
              color={genderOne === 'female' ? PINK : BLUE}
              compact={compact}
              disabled={conversationRunning}
              gender={genderOne}
              onGenderPress={() => setGenderOne((current) => current === 'female' ? 'male' : 'female')}
              onSourcePress={() => openLanguage('one')}
              onTargetPress={() => openLanguage('two')}
              speaker="Speaker (1) language"
              source={languageOne}
              target={languageTwo}
            />
            <DirectionRow
              color={genderTwo === 'female' ? PINK : BLUE}
              compact={compact}
              disabled={conversationRunning}
              gender={genderTwo}
              onGenderPress={() => setGenderTwo((current) => current === 'female' ? 'male' : 'female')}
              onSourcePress={() => openLanguage('two')}
              onTargetPress={() => openLanguage('one')}
              speaker="Speaker (2) language"
              source={languageTwo}
              target={languageOne}
            />
          </View>

          <Pressable accessibilityLabel={conversationRunning ? 'End conversation' : 'Start conversation'} accessibilityRole="button" onPress={toggleConversation} style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}>
            <LinearGradient colors={conversationRunning ? ['#334155', '#1F2937'] : ['#0A73FF', '#0848F4']} end={{ x: 1, y: 0.5 }} start={{ x: 0, y: 0.5 }} style={styles.startGradient}>
              <MicrophoneIcon ending={conversationRunning} />
              <Text style={styles.startText}>{conversationRunning ? 'End Conversation' : status === 'failed' ? 'Try Again' : 'Start Conversation'}</Text>
            </LinearGradient>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <AppMenu onClose={() => setOverlay(null)} onNavigate={setOverlay} visible={overlay === 'menu'} />
      <LanguageSheet onClose={() => setOverlay(null)} onSelect={chooseLanguage} selectedLanguage={languageSide === 'one' ? languageOne : languageTwo} visible={overlay === 'language'} />
      <CallingOverlay onClose={() => setOverlay(null)} visible={overlay === 'calling'} />
      <Modal animationType="fade" onRequestClose={stop} transparent visible={status === 'failed'}>
        <BlurView experimentalBlurMethod="dimezisBlurView" intensity={52} style={styles.connectionErrorBackdrop} tint="light">
          <View accessibilityViewIsModal style={styles.connectionErrorCard}>
            <Text style={styles.connectionErrorTitle}>Couldn’t Connect</Text>
            <Text style={styles.connectionErrorBody}>{errorMessage || 'Interpreter could not connect. Please try again.'}</Text>
            <Pressable accessibilityRole="button" onPress={() => void start()} style={styles.connectionRetry}><Text style={styles.connectionRetryText}>Try Again</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={stop} style={styles.connectionCancel}><Text style={styles.connectionCancelText}>Cancel</Text></Pressable>
          </View>
        </BlurView>
      </Modal>
      <DestinationSheet
        destination={overlay && overlay !== 'menu' && overlay !== 'language' && overlay !== 'calling' ? overlay : null}
        onClose={() => setOverlay(null)}
      />
    </View>
  );
}

function DirectionRow({ color, compact, disabled, gender, onGenderPress, onSourcePress, onTargetPress, source, speaker, target }: {
  color: string; compact: boolean; disabled: boolean; gender: Gender; onGenderPress: () => void; onSourcePress: () => void; onTargetPress: () => void; source: string; speaker: string; target: string;
}) {
  return (
    <View style={[styles.directionRow, compact && styles.directionRowCompact, disabled && styles.disabled]}>
      <Pressable accessibilityLabel={`Change ${speaker} icon`} accessibilityRole="button" disabled={disabled} hitSlop={7} onPress={onGenderPress} style={({ pressed }) => pressed && styles.pressed}><SpeakerIcon color={color} gender={gender} /></Pressable>
      <View style={styles.directionControl}>
        <Text style={styles.directionLabel}>{speaker}</Text>
        <LanguageButton color={color} disabled={disabled} language={source} onPress={onSourcePress} />
      </View>
      <View style={styles.arrowWrap}><DirectionArrow color={color} /></View>
      <View style={styles.directionControl}>
        <Text style={styles.directionLabel}>Interpret to</Text>
        <LanguageButton color={color} disabled={disabled} language={target} onPress={onTargetPress} />
      </View>
    </View>
  );
}

function LanguageButton({ color, disabled, language, onPress }: { color: string; disabled: boolean; language: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={`Select ${language}`} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.languageButton, pressed && styles.pressed]}>
      <GlobeIcon color={color} />
      <Text numberOfLines={1} style={styles.languageButtonText}>{languageLabel(language)}</Text>
      <ChevronIcon color={color} />
    </Pressable>
  );
}

function LanguageSheet({ onClose, onSelect, selectedLanguage, visible }: { onClose: () => void; onSelect: (language: string) => void; selectedLanguage: string; visible: boolean }) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={46} style={styles.modalBackdrop} tint="light">
        <Pressable accessibilityLabel="Close language selector" onPress={onClose} style={StyleSheet.absoluteFill} />
        <Pressable accessibilityViewIsModal onPress={() => undefined} style={styles.languageSheet}>
          <View style={styles.sheetHandle} /><Text style={styles.sheetTitle}>Choose language</Text>
          <ScrollView showsVerticalScrollIndicator={false}>{LANGUAGES.map((language) => (
            <Pressable key={language} onPress={() => onSelect(language)} style={[styles.languageOption, selectedLanguage === language && styles.languageOptionSelected]}>
              <Text style={styles.languageOptionText}>{languageLabel(language)}</Text>{selectedLanguage === language ? <Text style={styles.checkmark}>✓</Text> : null}
            </Pressable>
          ))}</ScrollView>
        </Pressable>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#FFFFFF', flex: 1 },
  safeArea: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 22, paddingHorizontal: 24 },
  contentCompact: { paddingBottom: 14, paddingHorizontal: 18 },
  menuButton: { alignItems: 'center', height: 48, justifyContent: 'center', position: 'absolute', right: 12, top: 8, width: 48, zIndex: 2 },
  phoneButton: { alignItems: 'center', height: 48, justifyContent: 'center', left: 12, position: 'absolute', top: 8, width: 48, zIndex: 2 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.56 },
  hero: { alignItems: 'center', marginTop: 24 },
  heroCompact: { marginTop: 10 },
  logo: { height: 105, width: 105 },
  logoCompact: { height: 88, width: 88 },
  wordmark: { color: BLUE, fontSize: 47, fontWeight: '800', letterSpacing: -2, lineHeight: 53, marginTop: 2 },
  tagline: { color: '#65718A', fontSize: 19, marginTop: 2 },
  orbWrap: { alignItems: 'center', alignSelf: 'center', height: 248, justifyContent: 'center', marginTop: 20, width: 248 },
  orbWrapCompact: { height: 188, marginTop: 10, width: 188 },
  orbGlow: { backgroundColor: '#F8FAFF', borderRadius: 124, height: 248, position: 'absolute', shadowColor: BLUE, shadowOpacity: 0.16, shadowRadius: 24, width: 248 },
  orbGlowCompact: { borderRadius: 94, height: 188, width: 188 },
  orb: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#EEF4FF', borderRadius: 112, borderWidth: 8, height: 224, justifyContent: 'center', width: 224 },
  orbCompact: { borderRadius: 84, borderWidth: 7, height: 168, width: 168 },
  dottedRing: { alignItems: 'center', borderColor: BLUE, borderRadius: 98, borderStyle: 'dotted', borderWidth: 2.4, height: 196, justifyContent: 'center', width: 196 },
  dottedRingCompact: { borderRadius: 72, height: 144, width: 144 },
  statusText: { color: '#101828', fontSize: 14, marginTop: 4, textAlign: 'center' },
  rows: { alignSelf: 'center', gap: 16, marginTop: 20, maxWidth: 520, width: '100%' },
  rowsCompact: { gap: 10, marginTop: 10 },
  directionRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 },
  directionRowCompact: { gap: 5 },
  directionControl: { flex: 1, minWidth: 0 },
  directionLabel: { color: '#5E6B84', fontSize: 10, marginBottom: 5, marginLeft: 4 },
  languageButton: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E2E8F2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', height: 49, paddingHorizontal: 9, shadowColor: '#0B2559', shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.07, shadowRadius: 8 },
  languageButtonText: { color: '#101828', flex: 1, fontSize: 13, marginHorizontal: 6 },
  arrowWrap: { alignItems: 'center', height: 49, justifyContent: 'center', width: 32 },
  startButton: { alignSelf: 'center', borderRadius: 32, marginTop: 'auto', maxWidth: 480, overflow: 'hidden', shadowColor: BLUE, shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.22, shadowRadius: 16, width: '84%' },
  startGradient: { alignItems: 'center', flexDirection: 'row', height: 62, justifyContent: 'center' },
  startText: { color: '#FFFFFF', fontSize: 19, fontWeight: '600', marginLeft: 14 },
  modalBackdrop: { backgroundColor: 'rgba(8, 18, 38, 0.16)', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: 'rgba(248,251,255,0.70)', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 28, paddingHorizontal: 22, paddingTop: 12 },
  languageSheet: { backgroundColor: 'rgba(248,251,255,0.70)', borderColor: 'rgba(255,255,255,0.96)', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, maxHeight: '82%', paddingBottom: 24, paddingHorizontal: 22, paddingTop: 12, shadowColor: '#164995', shadowOffset: { height: -8, width: 0 }, shadowOpacity: 0.18, shadowRadius: 28 },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#CBD5E1', borderRadius: 3, height: 5, marginBottom: 18, width: 44 },
  sheetTitle: { color: '#101828', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  menuRow: { alignItems: 'center', borderBottomColor: '#EEF1F6', borderBottomWidth: 1, flexDirection: 'row', minHeight: 66, paddingHorizontal: 5 },
  menuRowText: { flex: 1 },
  menuRowLabel: { color: '#101828', fontSize: 17, fontWeight: '600' },
  menuRowSubtitle: { color: '#667085', fontSize: 12, marginTop: 2 },
  languageOption: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', minHeight: 52, paddingHorizontal: 15 },
  languageOptionSelected: { backgroundColor: '#EEF4FF' },
  languageOptionText: { color: '#101828', flex: 1, fontSize: 17 },
  checkmark: { color: BLUE, fontSize: 22, fontWeight: '800' },
  connectionErrorBackdrop: { alignItems: 'center', backgroundColor: 'rgba(8,18,38,0.16)', flex: 1, justifyContent: 'center', padding: 24 },
  connectionErrorCard: { alignItems: 'center', backgroundColor: 'rgba(248,251,255,0.72)', borderColor: 'rgba(255,255,255,0.96)', borderRadius: 28, borderWidth: 1, maxWidth: 420, padding: 24, shadowColor: '#164995', shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.18, shadowRadius: 28, width: '100%' },
  connectionErrorTitle: { color: '#101828', fontSize: 22, fontWeight: '800' },
  connectionErrorBody: { color: '#475467', fontSize: 15, lineHeight: 22, marginTop: 10, textAlign: 'center' },
  connectionRetry: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 18, marginTop: 22, paddingVertical: 13, width: '100%' },
  connectionRetryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  connectionCancel: { alignItems: 'center', marginTop: 8, paddingVertical: 12, width: '100%' },
  connectionCancelText: { color: '#475467', fontSize: 15, fontWeight: '600' },
  infoSheet: { alignItems: 'center', backgroundColor: 'rgba(248,251,255,0.70)', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 34, paddingHorizontal: 28, paddingTop: 24 },
  infoLogo: { height: 68, width: 68 },
  infoTitle: { color: '#101828', fontSize: 24, fontWeight: '800', marginTop: 9 },
  infoBody: { color: '#475467', fontSize: 15, lineHeight: 22, marginTop: 12, textAlign: 'center' },
  doneButton: { backgroundColor: BLUE, borderRadius: 20, marginTop: 22, paddingHorizontal: 30, paddingVertical: 12 },
  doneText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
