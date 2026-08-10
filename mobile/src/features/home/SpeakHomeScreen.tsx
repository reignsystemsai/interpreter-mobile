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
import { useAudioPlayer } from 'expo-audio';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { useRealtimeInterpreter } from '../../hooks/useRealtimeInterpreter';
import { recordAppReady } from '../../services/performance';
import { CallingOverlay } from '../calling/CallingOverlay';
import { VoiceCallService } from '../calling/VoiceCallService';
import { useLanguagePreferences } from '../languages/LanguagePreferencesProvider';
import { AppMenu, type MenuDestination } from '../menu/AppMenu';
import { DestinationSheet } from '../menu/DestinationSheet';
import { SpeakCameraModal } from './CameraInterpreterModal';

const BLUE = '#145CF6';
const LIGHT_BLUE = '#A9D3FF';
const WHITE = '#FFFFFF';
const BLACK = '#03060D';
const SPEAK_SOUND = 'data:audio/wav;base64,UklGRqQHAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYAHAAAAABEZPCovLrkjKQ5D9CPes9J/1Zzl8f3TFm0oOy3DIw0Pq/Wo3/fTRdbM5ZP9BxZhJyAsyiJmDn71C+Do1J3XQufH/pgWDSfgKt8gTgza82zfndWR2fXpbwFZGEInVSnwHdQI7fAK3lbWTdzv7WwFCRutJzgn2RkEBPLsQ9x11xbgQPOQCkce2yclJGsU9f1E6Jbadtk75en5jRCMITYnrR+EDeH2aOOp2efc/uvKAeUWJyQXJWwZKgU67xjfP9pO4nn0gwrdHEAl1CAoEaf7u+c/3CDdCOp4/lsTdSHsI+wZ+Qau8XPh6tv34hz0VQk2G4EjVx84EHn7Zuix3RffEOwBAN0ToiDTIQ0XKgTh72Xh1N1r5hH4eAxYHA0ilRtJCwX3DeZz3ujiyvG4BYIXxCAuHrkQSf3o6jvgGeEo7QAAxBKjHlIfmhRrAm7vkeKC4Pnpd/uLDjcceR8oF1wGSvP75LHg+ucb+BcL5BkKH6kYKAlQ9ibnS+Hn5tj1gwjuF1YeXRnqCm743egN4obmkPTaBnwWkh12Gb8LpPkF6svireYo9BYGoBXeHBUZvgv6+ZXqcuNE5430KwZZFUQcSBj5Cn35luoD5EbosfULB5kVuBsQF3cJP/ge6pDkuumP96EIQhYgG1oVPAdX9k7pPuW36yb61AorF1EaDhNLBOTzWug85lrucf18DRoYFBkOEKoAE/GD58jnvvFhAWUQxRgpFz8Mc/wl7hnnIOr69dQFQhPWGFMUlwfU93Pre+eB7Qv7iwquFeoXXRAmAh3za+kI6RPyzQAkDzAXphUwCyf8xe6Q6BXs1vftBhQTQxfCEeUEC/Zn62Xp1fCT/tsMsxVrFSkM1v178LTpVew798cF1BFOFlgREQWy9lTsV+qM8d7+nAzvFFAUCgsZ/XPwgOrD7dH45wb4EUkVcg//Ak/1R+zI6wH0XwEXDqoURhL7B0X6Gu9R64jwc/zdCe4StBPhC+b+dPL8607uXvi8BYgQBRSyDu4C6/Vo7SHtL/X8AdoNixOOED0GM/k878Ls2vLG/jELkhKhEdIIG/ww8fHsQfEq/MAIWhEeErsKiv4P83btQvAn+qcGFxAzEg0MdgC29CPut++z+PkE7Q4IEuMM4AEN9tXuge++97sD9g26EVMNzgIJ93PviO859/ACPw1hEXENSQOm9/Dvuu8X95ICzgwGEUgNWQPk90bwDvBQ950CpAywEN8MBAPH93fwgvDe9wkDugxaEDgMTwJZ94rwG/HA+NEDBA36D00LQAGl9o7w4vH4+ekEcw2ADxcK2v+69Zjw6PKH+0UG8Q3WDo0IJv6w9MHwPPRs/dIHXw7mDaYGMPyi8yfx8fWj/3cJng6TDF8EDvq08u3xFPgdAhALhA7ICrwB3vcR8jLzq/rBBHEM6Q10CND+zfXq8RP1rf1nB2MNpgyTBbz7FPRw8p/3/wDUCa0NnQo2Arr49fLO89P6bwTCCxYNxQeH/hL2tPIf9o7+sQfeDHMLLwTP+iL0kPNf+Y8CZArbDLIIFAB190fzrfVl/W0GGgx9C+4E2Pv09NLzBfnUAaUJaQyzCHcAB/jJ8/L1Wv0eBqQLCgumBNn7Q/VZ9JL5KAKSCegL8wfQ/8/3LPTP9k/+rAZ2CyUKcgPx+ir1L/X3+mgD/wk4C3EGPP4D96H0W/grANsHSwukCFoBXfn99JH2O/1dBZAKBwoQBO37CPaR9cb6zAJECaoKQQZz/of3QfXd+FsAnwewCuIHxQBE+X31gPcu/tUFPgr9CMkCEvsc9qP2V/wLBHoJoglyBND8+/Yw9tv6XwKICOkJwQVn/vr3EPa4+eAAgwfpCbwGyv/++Cr24via/4MGuQluB/MA9vlq9lD4jv6YBW0J5QfiAdP6vvbz9739ywQVCSsIlwKO+xj3wPci/SMEvQhNCBgDIfxs9633uvylA24IUwhpA4v8tPex93/8UAMtCEUIjgPK/Oz3yPdv/CUD/gcmCIoD4fwT+O/3hvwiA+EH+QdhA9H8KPgj+MH8RQPTB70HEwOd/C/4aPgh/YoD0gdvB6ECSPws+L/4pf3tA9YHDAcMAtf7J/gv+Uz+aQTaB48GUwFR+yj4vPkW//cE0wfxBXkAvvo4+G36AACNBbYHLAWA/yj6ZfhG+wYBIAZ3BzwEbv6c+bn4TfwhAqEGCgcfA039KvlC+YH9RQP/BmMG1QEq/OX4Cvrf/mIEJwd4BWUAGfvf+Bj7XQBjBQcHRgTd/jD6Kvlu/OoBLQaMBs4CUf2K+df5BP5tA6cGqwUdAd/7Q/nt+sv/xQS0BmEESf+q+nX5avykAc0FPwa2AnX92vkw+j3+ZgNdBjwFwgDQ+5P5evtGAOEEUgawA7D+jvr0+UL9UgLcBZgFtAG6/OX5Cftl/yEEKQYtBHv/Jfv++cP8owFrBaUFLQJN/Tb67vr4/qsD8AVMBNb/gfsm+qj8WwElBYUFPwKB/W76D/v1/ocDvgUjBMr/mvtb+t/8dgEOBUQF9gFd/Yv6Y/tP/64DkQW3A2H/e/ui+mX95gEbBd0EWAHv/J368Ps=';

const LANGUAGES = [
  'English', 'Spanish', 'Brazilian Portuguese', 'French', 'German', 'Italian',
  'Dutch', 'Russian', 'Polish', 'Romanian', 'Turkish', 'Arabic', 'Hebrew',
  'Hindi', 'Japanese', 'Korean', 'Mandarin Chinese', 'Cantonese', 'Vietnamese', 'Thai',
] as const;

type Overlay = 'calling' | 'camera' | 'languageOne' | 'languageTwo' | 'menu' | 'speakTools' | MenuDestination | null;

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
  return <View style={{ alignItems: 'center', height: size, justifyContent: 'center', width: size }}>
    <Animated.View pointerEvents="none" style={[styles.outerBand, { borderRadius: size * 0.61, height: size * 1.22, width: size * 1.22 }, animatedStyle]} />
    <Animated.View pointerEvents="none" style={[styles.outerBand, styles.outerBandSoft, { borderRadius: size * 0.72, height: size * 1.44, width: size * 1.44 }, animatedStyle]} />
    <Animated.View style={[styles.livingRing, { borderRadius: size / 2, height: size, width: size }, animatedStyle]}>{children}</Animated.View>
  </View>;
}

export function SpeakHomeScreen() {
  const { languageOne, languageTwo, setLanguageOne, setLanguageTwo } = useLanguagePreferences();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const { errorMessage, isActive, start, status, stop } = useRealtimeInterpreter(languageOne, languageTwo);
  const activationPlayer = useAudioPlayer({ uri: SPEAK_SOUND });
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
    void activationPlayer.seekTo(0).then(() => activationPlayer.play()).catch(() => undefined);
    if (busy) stop();
    else void start();
  };

  const openCamera = () => {
    if (busy) stop();
    setOverlay('camera');
  };

  const destination = overlay && !['calling', 'camera', 'languageOne', 'languageTwo', 'menu', 'speakTools'].includes(overlay) ? overlay as MenuDestination : null;

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

        <Pressable accessibilityRole="button" onPress={toggleConversation} style={({ pressed }) => [styles.speakButton, pressed && styles.pressed]}><MicrophoneIcon /><Text style={styles.speakButtonText}>{busy ? 'Stop' : 'Speak Now'}</Text></Pressable>
        <Text style={styles.startConversation}>{busy ? 'Conversation active' : 'Start Conversation'}</Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerSpacer} />
        <Pressable accessibilityLabel="Open Speak tools" accessibilityRole="button" onPress={() => setOverlay('speakTools')}><LivingRing size={78}><Text style={styles.sHub}>S</Text></LivingRing></Pressable>
        <Pressable accessibilityLabel="Open utilities" accessibilityRole="button" hitSlop={18} onPress={() => setOverlay('menu')} style={styles.plusButton}><Text style={styles.plus}>+</Text></Pressable>
      </View>
    </SafeAreaView>

    <CallingOverlay onClose={() => setOverlay(null)} visible={overlay === 'calling'} />
    <SpeakCameraModal onClose={() => setOverlay(null)} visible={overlay === 'camera'} />
    <AppMenu onClose={() => setOverlay(null)} onNavigate={setOverlay} visible={overlay === 'menu'} />
    <DestinationSheet destination={destination} onClose={() => setOverlay(null)} />

    <Modal animationType="fade" onRequestClose={() => setOverlay(null)} transparent visible={overlay === 'languageOne' || overlay === 'languageTwo'}>
      <BlurView intensity={35} style={styles.modalBackdrop} tint="light"><Pressable onPress={() => setOverlay(null)} style={StyleSheet.absoluteFill} /><View style={styles.sheet}><Text style={styles.sheetTitle}>Choose language</Text><ScrollView>{LANGUAGES.map((language) => <Pressable key={language} onPress={() => chooseLanguage(language)} style={styles.sheetRow}><Text style={styles.sheetRowText}>{language}</Text></Pressable>)}</ScrollView></View></BlurView>
    </Modal>

    <Modal animationType="fade" onRequestClose={() => setOverlay(null)} transparent visible={overlay === 'speakTools'}>
      <BlurView intensity={35} style={styles.toolsBackdrop} tint="dark"><Pressable onPress={() => setOverlay(null)} style={StyleSheet.absoluteFill} /><View style={styles.toolsCard}><Text style={styles.toolsTitle}>Speak tools</Text><Pressable accessibilityRole="button" onPress={openCamera} style={styles.cameraTool}><CameraIcon /><Text style={styles.cameraText}>Camera</Text></Pressable></View></BlurView>
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
  outerBand: { borderColor: 'rgba(20,92,246,0.46)', borderWidth: 1.5, position: 'absolute', shadowColor: BLUE, shadowOpacity: 0.55, shadowRadius: 20 },
  outerBandSoft: { borderColor: 'rgba(71,139,255,0.22)', borderWidth: 1 },
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
