import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { useRealtimeInterpreter } from '../../hooks/useRealtimeInterpreter';
import { recordAppReady } from '../../services/performance';
import { CallingOverlay } from '../calling/CallingOverlay';
import { VoiceCallService } from '../calling/VoiceCallService';
import { useLanguagePreferences } from '../languages/LanguagePreferencesProvider';
import { AppMenu, type MenuDestination } from '../menu/AppMenu';
import { DestinationSheet } from '../menu/DestinationSheet';

const BLUE = '#145CF6';
const LIGHT_BLUE = '#A9D3FF';
const WHITE = '#FFFFFF';
const BLACK = '#03060D';

const LANGUAGES = [
  'English', 'Spanish', 'Brazilian Portuguese', 'French', 'German', 'Italian',
  'Dutch', 'Russian', 'Polish', 'Romanian', 'Turkish', 'Arabic', 'Hebrew',
  'Hindi', 'Japanese', 'Korean', 'Mandarin Chinese', 'Cantonese', 'Vietnamese', 'Thai',
] as const;

type Overlay = 'calling' | 'languageOne' | 'languageTwo' | 'menu' | 'speakTools' | MenuDestination | null;

function PhoneIcon() {
  return <Svg height={30} viewBox="0 0 32 32" width={30}><Path d="M8.2 4.8 12 4l3.1 7.1-2.8 2.2c1.6 3.2 4.1 5.7 7.3 7.3l2.2-2.8L29 21l-.8 3.8c-.4 2-2.2 3.4-4.3 3.2C13.4 27 5 18.6 4 8.1 3.8 6 5.2 4.2 7.2 3.8" fill="none" stroke={BLUE} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} /></Svg>;
}

function MicrophoneIcon({ color = WHITE, size = 27 }: { color?: string; size?: number }) {
  return <Svg height={size} viewBox="0 0 96 96" width={size}>
    <Path d="M34 20a14 14 0 0 1 28 0v29a14 14 0 0 1-28 0V20Z" fill="none" stroke={color} strokeWidth={7} />
    <Path d="M22 46v4a26 26 0 0 0 52 0v-4M48 76v14M35 90h26" fill="none" stroke={color} strokeLinecap="round" strokeWidth={7} />
  </Svg>;
}

function WaveIcon() {
  return <Svg height={26} viewBox="0 0 38 26" width={38}>{[5, 11, 17, 23, 29, 35].map((x, index) => <Line key={x} stroke={WHITE} strokeLinecap="round" strokeWidth={2.4} x1={x} x2={x} y1={index % 2 ? 4 : 8} y2={index % 2 ? 22 : 18} />)}</Svg>;
}

function CameraIcon() {
  return <Svg height={28} viewBox="0 0 32 32" width={28}><Path d="M6 9h5l2-3h6l2 3h5a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3Z" fill="none" stroke={BLUE} strokeWidth={2.2} /><Circle cx={16} cy={18} fill="none" r={6} stroke={BLUE} strokeWidth={2.2} /></Svg>;
}

function LivingRing({ children, size }: { children: ReactNode; size: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { duration: 1300, toValue: 1, useNativeDriver: true }),
      Animated.timing(pulse, { duration: 1300, toValue: 0, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse]);
  const animatedStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.68, 1] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1.035] }) }],
  };
  return <Animated.View style={[styles.livingRing, { borderRadius: size / 2, height: size, width: size }, animatedStyle]}>{children}</Animated.View>;
}

export function SpeakHomeScreen() {
  const { languageOne, languageTwo, setLanguageOne, setLanguageTwo } = useLanguagePreferences();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const { errorMessage, isActive, start, status, stop } = useRealtimeInterpreter(languageOne, languageTwo);
  const busy = isActive || ['requesting_permission', 'creating_session', 'connecting', 'connected', 'reconnecting'].includes(status);
  const listening = ['detecting', 'listening'].includes(status);
  const speaking = ['translating', 'speaking'].includes(status);

  useEffect(() => { recordAppReady(); }, []);
  useEffect(() => VoiceCallService.subscribe((call) => {
    if (call.role === 'recipient' && call.status === 'ringing') {
      setOverlay(null);
      if (busy) stop();
    }
  }), [busy, stop]);

  const statusLabel = useMemo(() => {
    if (speaking) return 'Translating';
    if (listening) return 'Listening';
    if (busy) return 'Connecting';
    return 'Ready';
  }, [busy, listening, speaking]);

  const chooseLanguage = (language: string) => {
    if (overlay === 'languageOne') {
      if (language === languageTwo) setLanguageTwo(languageOne);
      setLanguageOne(language);
    } else if (overlay === 'languageTwo') {
      if (language === languageOne) setLanguageOne(languageTwo);
      setLanguageTwo(language);
    }
    setOverlay(null);
  };

  const toggleConversation = () => {
    Vibration.vibrate(12);
    if (busy) stop();
    else void start();
  };

  const destination = overlay && !['calling', 'languageOne', 'languageTwo', 'menu', 'speakTools'].includes(overlay) ? overlay as MenuDestination : null;

  return <View style={styles.page}>
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.brand}><View style={styles.brandBars}>{[16, 28, 40, 25, 14].map((height, index) => <View key={`${height}-${index}`} style={[styles.brandBar, { height }]} />)}</View><View><Text style={styles.brandName}>Speak</Text><Text style={styles.tagline}>The world speaks here.</Text></View></View>
        <Pressable accessibilityLabel="Open calling" accessibilityRole="button" disabled={busy} onPress={() => setOverlay('calling')}><LivingRing size={70}><PhoneIcon /></LivingRing></Pressable>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Speak languages</Text>
        <View style={styles.languages}>
          <Pressable disabled={busy} onPress={() => setOverlay('languageOne')} style={styles.languageLight}><Text numberOfLines={1} style={styles.languageLightText}>{languageOne}</Text><Text style={styles.lightChevron}>⌄</Text></Pressable>
          <Pressable disabled={busy} onPress={() => { const first = languageOne; setLanguageOne(languageTwo); setLanguageTwo(first); }}><Text style={styles.swap}>⇄</Text></Pressable>
          <Pressable disabled={busy} onPress={() => setOverlay('languageTwo')} style={styles.languageBlue}><Text numberOfLines={1} style={styles.languageBlueText}>{languageTwo}</Text><Text style={styles.blueChevron}>⌄</Text></Pressable>
        </View>

        <View style={styles.microphoneArea}>
          <LivingRing size={232}><View style={[styles.microphoneCore, (listening || speaking) && styles.microphoneActive]}><Text accessibilityLiveRegion="polite" style={styles.readyText}>{statusLabel}</Text><Text style={styles.readyHint}>{busy ? 'Live interpretation' : 'Tap Speak Now'}</Text></View></LivingRing>
        </View>

        <Pressable accessibilityRole="button" onPress={toggleConversation} style={({ pressed }) => [styles.speakButton, pressed && styles.pressed]}><WaveIcon /><Text style={styles.speakButtonText}>{busy ? 'Stop' : 'Speak Now'}</Text></Pressable>
        <Text style={styles.startConversation}>{busy ? 'Conversation active' : 'Start Conversation'}</Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerSpacer} />
        <Pressable accessibilityLabel="Open Speak tools" accessibilityRole="button" onPress={() => setOverlay('speakTools')}><LivingRing size={78}><Text style={styles.sHub}>S</Text></LivingRing></Pressable>
        <Pressable accessibilityLabel="Open utilities" accessibilityRole="button" hitSlop={18} onPress={() => setOverlay('menu')} style={styles.plusButton}><Text style={styles.plus}>+</Text></Pressable>
      </View>
    </SafeAreaView>

    <CallingOverlay onClose={() => setOverlay(null)} visible={overlay === 'calling'} />
    <AppMenu onClose={() => setOverlay(null)} onNavigate={setOverlay} visible={overlay === 'menu'} />
    <DestinationSheet destination={destination} onClose={() => setOverlay(null)} />

    <Modal animationType="fade" onRequestClose={() => setOverlay(null)} transparent visible={overlay === 'languageOne' || overlay === 'languageTwo'}>
      <BlurView intensity={35} style={styles.modalBackdrop} tint="light"><Pressable onPress={() => setOverlay(null)} style={StyleSheet.absoluteFill} /><View style={styles.sheet}><Text style={styles.sheetTitle}>Choose language</Text><ScrollView>{LANGUAGES.map((language) => <Pressable key={language} onPress={() => chooseLanguage(language)} style={styles.sheetRow}><Text style={styles.sheetRowText}>{language}</Text></Pressable>)}</ScrollView></View></BlurView>
    </Modal>

    <Modal animationType="fade" onRequestClose={() => setOverlay(null)} transparent visible={overlay === 'speakTools'}>
      <BlurView intensity={35} style={styles.toolsBackdrop} tint="light"><Pressable onPress={() => setOverlay(null)} style={StyleSheet.absoluteFill} /><View style={styles.toolsCard}><Text style={styles.toolsTitle}>Speak tools</Text><Pressable accessibilityRole="button" onPress={() => setOverlay(null)} style={styles.cameraTool}><CameraIcon /><Text style={styles.cameraText}>Camera</Text></Pressable></View></BlurView>
    </Modal>

    <Modal animationType="fade" onRequestClose={stop} transparent visible={status === 'failed'}><BlurView intensity={42} style={styles.errorBackdrop} tint="light"><View style={styles.errorCard}><Text style={styles.errorTitle}>Couldn’t Connect</Text><Text style={styles.errorBody}>{errorMessage || 'Interpreter could not connect. Please try again.'}</Text><Pressable onPress={() => void start()} style={styles.errorAction}><Text style={styles.errorActionText}>Try Again</Text></Pressable><Pressable onPress={stop}><Text style={styles.errorCancel}>Cancel</Text></Pressable></View></BlurView></Modal>
  </View>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: BLACK, flex: 1 },
  safe: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 8 },
  brand: { alignItems: 'center', flexDirection: 'row' },
  brandBars: { alignItems: 'center', flexDirection: 'row', gap: 4, marginRight: 10 },
  brandBar: { backgroundColor: BLUE, borderRadius: 3, width: 3 },
  brandName: { color: WHITE, fontSize: 27, fontWeight: '700' },
  tagline: { color: '#8CB8FF', fontSize: 11, marginTop: -2 },
  livingRing: { alignItems: 'center', borderColor: BLUE, borderWidth: 2, justifyContent: 'center', shadowColor: BLUE, shadowOpacity: 0.24, shadowRadius: 14 },
  content: { alignItems: 'center', flex: 1, paddingHorizontal: 24, paddingTop: 38 },
  title: { color: BLUE, fontSize: 39, fontWeight: '600', letterSpacing: -1.5 },
  languages: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 28, width: '100%' },
  languageLight: { alignItems: 'center', backgroundColor: LIGHT_BLUE, borderRadius: 25, flex: 1, flexDirection: 'row', height: 58, justifyContent: 'space-between', paddingHorizontal: 18 },
  languageBlue: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 25, flex: 1, flexDirection: 'row', height: 58, justifyContent: 'space-between', paddingHorizontal: 18 },
  languageLightText: { color: BLUE, flex: 1, fontSize: 17, fontWeight: '600' },
  languageBlueText: { color: WHITE, flex: 1, fontSize: 17, fontWeight: '600' },
  lightChevron: { color: BLUE, fontSize: 23 },
  blueChevron: { color: WHITE, fontSize: 23 },
  swap: { color: BLUE, fontSize: 34, fontWeight: '700' },
  microphoneArea: { alignItems: 'center', marginTop: 52 },
  microphoneCore: { alignItems: 'center', backgroundColor: BLACK, borderRadius: 108, height: 216, justifyContent: 'center', width: 216 },
  microphoneActive: { backgroundColor: '#071A42', shadowColor: BLUE, shadowOpacity: 0.55, shadowRadius: 30 },
  readyText: { color: WHITE, fontSize: 35, fontWeight: '700', letterSpacing: -0.8 },
  readyHint: { color: '#7EB1FF', fontSize: 12, fontWeight: '600', marginTop: 7 },
  speakButton: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 28, flexDirection: 'row', height: 62, justifyContent: 'center', marginTop: 31, width: '88%' },
  speakButtonText: { color: WHITE, fontSize: 21, fontWeight: '600', marginLeft: 12 },
  startConversation: { color: BLUE, fontSize: 15, marginTop: 14 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  footer: { alignItems: 'center', flexDirection: 'row', paddingBottom: 7, paddingHorizontal: 24 },
  footerSpacer: { flex: 1 },
  sHub: { color: BLUE, fontSize: 45, fontWeight: '600' },
  plusButton: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  plus: { color: BLUE, fontSize: 47, fontWeight: '300' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#07101F', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '70%', padding: 22 },
  sheetTitle: { color: BLUE, fontSize: 24, fontWeight: '700', marginBottom: 10 },
  sheetRow: { borderBottomColor: '#DCE8FF', borderBottomWidth: 1, justifyContent: 'center', minHeight: 52 },
  sheetRowText: { color: WHITE, fontSize: 17 },
  toolsBackdrop: { alignItems: 'center', flex: 1, justifyContent: 'flex-end', padding: 24 },
  toolsCard: { backgroundColor: '#07101F', borderColor: BLUE, borderRadius: 28, borderWidth: 1, padding: 22, width: '100%' },
  toolsTitle: { color: BLUE, fontSize: 22, fontWeight: '700' },
  cameraTool: { alignItems: 'center', backgroundColor: '#EAF3FF', borderRadius: 22, flexDirection: 'row', marginTop: 18, minHeight: 62, paddingHorizontal: 20 },
  cameraText: { color: BLUE, fontSize: 18, fontWeight: '600', marginLeft: 14 },
  errorBackdrop: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  errorCard: { alignItems: 'center', backgroundColor: '#07101F', borderColor: BLUE, borderRadius: 24, borderWidth: 1, padding: 24, width: '100%' },
  errorTitle: { color: BLUE, fontSize: 23, fontWeight: '700' },
  errorBody: { color: BLUE, fontSize: 15, lineHeight: 22, marginTop: 10, textAlign: 'center' },
  errorAction: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 22, marginTop: 20, padding: 14, width: '100%' },
  errorActionText: { color: WHITE, fontSize: 17, fontWeight: '700' },
  errorCancel: { color: BLUE, fontSize: 16, marginTop: 16 },
});
