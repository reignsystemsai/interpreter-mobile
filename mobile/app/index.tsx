import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { AudioWaveform } from '../src/components/AudioWaveform';
import { useDemoAudioLevel } from '../src/hooks/useDemoAudioLevel';
import {
  type RealtimeMode,
  useRealtimeInterpreter,
} from '../src/hooks/useRealtimeInterpreter';

const TARGET_LANGUAGES = [
  { label: 'Spanish', value: 'Spanish' },
  { label: 'Português (Brasil)', value: 'Brazilian Portuguese' },
] as const;

const COMPANION_LANGUAGES = [
  { label: 'English', value: 'English' },
  ...TARGET_LANGUAGES,
] as const;

type Sheet = 'language' | 'menu' | null;

function MenuIcon() {
  return (
    <Svg height={32} viewBox="0 0 32 32" width={32}>
      {[7, 16, 25].map((y) => (
        <Line
          key={y}
          stroke="#075BFF"
          strokeLinecap="round"
          strokeWidth={3}
          x1={5}
          x2={27}
          y1={y}
          y2={y}
        />
      ))}
    </Svg>
  );
}

function BrandMark() {
  return (
    <View style={styles.brandMark}>
      <View style={styles.brandTail} />
      <Text style={styles.brandLetter}>i</Text>
    </View>
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

function ChevronIcon() {
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path d="m5 8 7 7 7-7" fill="none" stroke="#075BFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} />
    </Svg>
  );
}

function MicrophoneIcon({ stopped }: { stopped: boolean }) {
  return (
    <Svg height={34} viewBox="0 0 34 34" width={34}>
      {stopped ? (
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
  const [mode, setMode] = useState<RealtimeMode>('browser-two-way');
  const [targetLanguage, setTargetLanguage] = useState('Spanish');
  const [companionLanguage, setCompanionLanguage] = useState('English');
  const [sheet, setSheet] = useState<Sheet>(null);
  const companion = mode === 'companion';
  const activeLanguage = companion ? companionLanguage : targetLanguage;
  const languageOptions = companion ? COMPANION_LANGUAGES : TARGET_LANGUAGES;
  const selectedLanguageLabel =
    languageOptions.find((option) => option.value === activeLanguage)?.label ??
    activeLanguage;

  const {
    diagnosticMessage,
    errorMessage,
    isActive,
    start,
    status,
    stop,
  } = useRealtimeInterpreter(
    companion ? companionLanguage : 'English',
    companion ? companionLanguage : targetLanguage,
    mode,
  );
  const audioLevel = useDemoAudioLevel(isActive);

  const statusText = useMemo(() => {
    if (status === 'connecting') return 'Connecting…';
    if (status === 'translating') return companion ? 'Thinking…' : 'Translating…';
    if (status === 'speaking') return 'Speaking…';
    if (status === 'error') return 'Tap below to try again';
    if (isActive) {
      return companion ? 'Listening…' : `Listening for ${selectedLanguageLabel} or English…`;
    }
    return 'Ready to listen';
  }, [companion, isActive, selectedLanguageLabel, status]);

  const closeAndSetMode = (nextMode: RealtimeMode) => {
    if (isActive) stop();
    setMode(nextMode);
    setSheet(null);
  };

  const chooseLanguage = (value: string) => {
    if (companion) setCompanionLanguage(value);
    else setTargetLanguage(value);
    setSheet(null);
  };

  return (
    <View style={styles.page}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <ScrollView
          bounces={false}
          contentContainerStyle={[styles.content, compact && styles.contentCompact]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <View style={styles.topSpacer} />
            <Pressable
              accessibilityLabel="Open mode menu"
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => setSheet('menu')}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <MenuIcon />
            </Pressable>
          </View>

          <View style={[styles.hero, compact && styles.heroCompact]}>
            <BrandMark />
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.wordmark}>
              interpreter
            </Text>
            <Text style={styles.tagline}>
              {companion ? 'Talk naturally.' : 'Speak any language.'}
            </Text>
          </View>

          <Pressable
            accessibilityHint="Opens language choices"
            accessibilityLabel={`${companion ? 'Conversation language' : 'Language to interpret to'}: ${selectedLanguageLabel}`}
            accessibilityRole="button"
            disabled={isActive}
            onPress={() => setSheet('language')}
            style={({ pressed }) => [
              styles.languageCard,
              compact && styles.languageCardCompact,
              pressed && styles.pressed,
              isActive && styles.disabled,
            ]}
          >
            <GlobeIcon />
            <View style={styles.languageText}>
              <Text style={styles.languageLabel}>
                {companion ? 'Conversation language' : 'Language to interpret to'}
              </Text>
              <Text numberOfLines={1} style={styles.languageValue}>
                {selectedLanguageLabel}
              </Text>
            </View>
            <ChevronIcon />
          </Pressable>

          <View style={[styles.listenerWrap, compact && styles.listenerWrapCompact]}>
            <View style={[styles.listenerGlow, compact && styles.listenerGlowCompact]} />
            <View style={[styles.listenerCircle, compact && styles.listenerCircleCompact]}>
              <View style={[styles.dottedCircle, compact && styles.dottedCircleCompact]}>
                <AudioWaveform active={isActive} audioLevel={audioLevel} />
                <Text numberOfLines={2} style={styles.statusText}>
                  {statusText}
                </Text>
              </View>
            </View>
          </View>

          <Text accessibilityLiveRegion="polite" numberOfLines={2} style={[styles.message, errorMessage && styles.errorMessage]}>
            {errorMessage ?? (isActive ? diagnosticMessage : null) ?? ' '}
          </Text>

          <Pressable
            accessibilityLabel={isActive ? 'Stop conversation' : 'Start conversation'}
            accessibilityRole="button"
            onPress={() => {
              if (isActive) stop();
              else void start();
            }}
            style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
          >
            <LinearGradient
              colors={isActive ? ['#374151', '#1F2937'] : ['#0879FF', '#0645F5']}
              end={{ x: 1, y: 0.5 }}
              start={{ x: 0, y: 0.5 }}
              style={styles.buttonGradient}
            >
              <MicrophoneIcon stopped={isActive} />
              <Text style={styles.startButtonText}>
                {isActive ? 'Stop conversation' : 'Start conversation'}
              </Text>
            </LinearGradient>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <Modal
        animationType="fade"
        onRequestClose={() => setSheet(null)}
        transparent
        visible={sheet !== null}
      >
        <Pressable onPress={() => setSheet(null)} style={styles.modalBackdrop}>
          <Pressable accessibilityViewIsModal onPress={() => undefined} style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {sheet === 'menu' ? 'Choose mode' : companion ? 'Conversation language' : 'Interpret to'}
            </Text>
            {sheet === 'menu' ? (
              <>
                <SheetOption
                  active={!companion}
                  label="Interpreter"
                  onPress={() => closeAndSetMode('browser-two-way')}
                  subtitle="English ↔ Spanish or Portuguese"
                />
                <SheetOption
                  active={companion}
                  label="Companion"
                  onPress={() => closeAndSetMode('companion')}
                  subtitle="A natural voice conversation"
                />
              </>
            ) : (
              languageOptions.map((option) => (
                <SheetOption
                  active={option.value === activeLanguage}
                  key={option.value}
                  label={option.label}
                  onPress={() => chooseLanguage(option.value)}
                />
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SheetOption({
  active,
  label,
  onPress,
  subtitle,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  subtitle?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.sheetOption, active && styles.sheetOptionActive, pressed && styles.pressed]}
    >
      <View style={styles.sheetOptionText}>
        <Text style={styles.sheetOptionLabel}>{label}</Text>
        {subtitle ? <Text style={styles.sheetOptionSubtitle}>{subtitle}</Text> : null}
      </View>
      {active ? <Text style={styles.checkmark}>✓</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#FFFFFF', flex: 1 },
  safeArea: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 22, paddingHorizontal: 28 },
  contentCompact: { paddingBottom: 14, paddingHorizontal: 22 },
  topBar: { alignItems: 'flex-end', height: 58, justifyContent: 'center' },
  topSpacer: { flex: 1 },
  iconButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  pressed: { opacity: 0.62 },
  hero: { alignItems: 'center', marginTop: 18 },
  heroCompact: { marginTop: 2 },
  brandMark: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 60,
    height: 108,
    justifyContent: 'center',
    shadowColor: '#0B51D8',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    width: 108,
  },
  brandTail: {
    backgroundColor: '#FFFFFF',
    bottom: 1,
    height: 31,
    left: 10,
    position: 'absolute',
    transform: [{ rotate: '28deg' }],
    width: 31,
  },
  brandLetter: { color: '#075BFF', fontFamily: 'serif', fontSize: 76, fontWeight: '700', lineHeight: 88 },
  wordmark: { color: '#075BFF', fontFamily: 'serif', fontSize: 54, fontWeight: '700', letterSpacing: -2.2, marginTop: 14, maxWidth: '100%' },
  tagline: { color: '#697386', fontSize: 21, marginTop: 8 },
  languageCard: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    flexDirection: 'row',
    marginTop: 40,
    maxWidth: 480,
    minHeight: 94,
    paddingHorizontal: 25,
    shadowColor: '#075BFF',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    width: '100%',
  },
  languageCardCompact: { marginTop: 22, minHeight: 82 },
  languageText: { flex: 1, marginHorizontal: 20 },
  languageLabel: { color: '#687793', fontSize: 14 },
  languageValue: { color: '#0B0B0C', fontSize: 24, marginTop: 5 },
  disabled: { opacity: 0.62 },
  listenerWrap: { alignItems: 'center', alignSelf: 'center', height: 300, justifyContent: 'center', marginTop: 34, width: 300 },
  listenerWrapCompact: { height: 240, marginTop: 20, width: 240 },
  listenerGlow: { backgroundColor: '#F7FAFF', borderRadius: 150, height: 300, position: 'absolute', shadowColor: '#075BFF', shadowOpacity: 0.17, shadowRadius: 26, width: 300 },
  listenerGlowCompact: { borderRadius: 120, height: 240, width: 240 },
  listenerCircle: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#F2F6FF', borderRadius: 136, borderWidth: 10, height: 272, justifyContent: 'center', width: 272 },
  listenerCircleCompact: { borderRadius: 108, borderWidth: 8, height: 216, width: 216 },
  dottedCircle: { alignItems: 'center', borderColor: '#075BFF', borderRadius: 118, borderStyle: 'dotted', borderWidth: 2.5, height: 236, justifyContent: 'center', width: 236 },
  dottedCircleCompact: { borderRadius: 94, height: 188, width: 188 },
  statusText: { color: '#101216', fontSize: 17, lineHeight: 23, marginTop: 15, maxWidth: 190, textAlign: 'center' },
  message: { color: '#778196', fontSize: 12, height: 32, lineHeight: 16, marginTop: 2, textAlign: 'center' },
  errorMessage: { color: '#B42318' },
  startButton: { alignSelf: 'center', borderRadius: 34, marginTop: 'auto', maxWidth: 480, overflow: 'hidden', shadowColor: '#075BFF', shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.24, shadowRadius: 18, width: '100%' },
  startButtonPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  buttonGradient: { alignItems: 'center', flexDirection: 'row', height: 68, justifyContent: 'center', paddingHorizontal: 22 },
  startButtonText: { color: '#FFFFFF', fontSize: 21, marginLeft: 18 },
  modalBackdrop: { backgroundColor: 'rgba(8, 18, 38, 0.28)', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingBottom: 30, paddingHorizontal: 24, paddingTop: 12 },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#D5DBE7', borderRadius: 3, height: 5, marginBottom: 20, width: 44 },
  sheetTitle: { color: '#101216', fontSize: 24, fontWeight: '700', marginBottom: 14 },
  sheetOption: { alignItems: 'center', borderRadius: 18, flexDirection: 'row', minHeight: 68, paddingHorizontal: 18, paddingVertical: 10 },
  sheetOptionActive: { backgroundColor: '#EDF4FF' },
  sheetOptionText: { flex: 1 },
  sheetOptionLabel: { color: '#101216', fontSize: 18, fontWeight: '600' },
  sheetOptionSubtitle: { color: '#687793', fontSize: 13, marginTop: 3 },
  checkmark: { color: '#075BFF', fontSize: 24, fontWeight: '700' },
});
