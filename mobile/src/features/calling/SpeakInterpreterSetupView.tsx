import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SpeakMark } from '../../components/SpeakNavigation';

const BLUE = '#0878FF';
const CYAN = '#19D7FF';
const PINK = '#F15BA9';

type CallType = 'video' | 'voice';
type VoiceGender = 'female' | 'male';

function Pair<T extends string>({ first, firstLabel, onChange, second, secondLabel, value }: {
  first: T;
  firstLabel: string;
  onChange: (value: T) => void;
  second: T;
  secondLabel: string;
  value: T;
}) {
  return <View style={styles.pair}>
    <Pressable onPress={() => onChange(first)} style={[styles.pairChoice, value === first && styles.pairSelected]}><Text style={[styles.pairText, value === first && styles.pairTextSelected]}>{firstLabel}</Text></Pressable>
    <Pressable onPress={() => onChange(second)} style={[styles.pairChoice, value === second && styles.pairSelected]}><Text style={[styles.pairText, value === second && styles.pairTextSelected]}>{secondLabel}</Text></Pressable>
  </View>;
}

export function SpeakInterpreterSetupView({
  callType,
  callerLanguage,
  creating,
  onBack,
  onCall,
  onCallType,
  onCallerLanguage,
  onRecipientLanguage,
  onSwap,
  onVoiceGender,
  recipientLanguage,
  voiceGender,
}: {
  callType: CallType;
  callerLanguage: string;
  creating: boolean;
  onBack: () => void;
  onCall: () => void;
  onCallType: (value: CallType) => void;
  onCallerLanguage: () => void;
  onRecipientLanguage: () => void;
  onSwap: () => void;
  onVoiceGender: (value: VoiceGender) => void;
  recipientLanguage: string;
  voiceGender: VoiceGender;
}) {
  return <View style={styles.page}>
    <Pressable accessibilityLabel="Back" hitSlop={14} onPress={onBack} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
    <SpeakMark />
    <Text style={styles.title}>Speak Interpreter</Text>

    <Pair first="voice" firstLabel="◉  Voice" onChange={onCallType} second="video" secondLabel="▣  Video" value={callType} />
    <Pair first="male" firstLabel="♂  Male" onChange={onVoiceGender} second="female" secondLabel="♀  Female" value={voiceGender} />

    <View style={styles.direction}>
      <Pressable accessibilityLabel="Choose first language" onPress={onCallerLanguage} style={styles.language}><Text style={styles.profile}>♙</Text><Text numberOfLines={1} style={styles.languageText}>{callerLanguage}</Text><Text style={styles.chevron}>⌄</Text></Pressable>
      <Pressable accessibilityLabel="Swap language direction" onPress={onSwap} style={styles.swap}><Text style={styles.swapText}>⇄</Text></Pressable>
      <Pressable accessibilityLabel="Choose second language" onPress={onRecipientLanguage} style={styles.language}><Text numberOfLines={1} style={styles.languageText}>{recipientLanguage}</Text><Text style={[styles.profile, styles.profileSecond]}>♙</Text><Text style={styles.chevron}>⌄</Text></Pressable>
    </View>

    <Pressable disabled={creating} onPress={onCall} style={({ pressed }) => [styles.call, creating && styles.disabled, pressed && styles.pressed]}><Text style={styles.callText}>{creating ? 'Calling…' : 'Call'}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  back: { alignItems: 'center', height: 44, justifyContent: 'center', left: 0, position: 'absolute', top: 4, width: 44, zIndex: 2 },
  backText: { color: BLUE, fontSize: 38, fontWeight: '300' },
  call: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#0737A9', borderColor: CYAN, borderRadius: 28, borderWidth: 1.5, justifyContent: 'center', marginTop: 54, minHeight: 56, shadowColor: CYAN, shadowOpacity: 0.58, shadowRadius: 15, width: '62%' },
  callText: { color: '#F8FBFF', fontSize: 18, fontWeight: '800' },
  chevron: { color: BLUE, fontSize: 18, marginLeft: 3 },
  direction: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 60, width: '88%' },
  disabled: { opacity: 0.5 },
  language: { alignItems: 'center', flexDirection: 'row', maxWidth: '38%' },
  languageText: { color: '#F8FBFF', fontSize: 15, fontWeight: '600', maxWidth: 92 },
  page: { alignItems: 'center', backgroundColor: '#020713', flex: 1, paddingHorizontal: 18, paddingTop: 34 },
  pair: { backgroundColor: 'rgba(4,16,38,0.72)', borderColor: 'rgba(45,156,255,0.22)', borderRadius: 21, borderWidth: 1, flexDirection: 'row', marginTop: 30, overflow: 'hidden', padding: 3, width: '58%' },
  pairChoice: { alignItems: 'center', borderRadius: 17, flex: 1, justifyContent: 'center', minHeight: 42, paddingHorizontal: 8 },
  pairSelected: { backgroundColor: '#072C75', borderColor: BLUE, borderWidth: 1, shadowColor: BLUE, shadowOpacity: 0.42, shadowRadius: 8 },
  pairText: { color: '#8BA6C9', fontSize: 14, fontWeight: '700' },
  pairTextSelected: { color: '#F8FBFF' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
  profile: { color: BLUE, fontSize: 25, marginRight: 6 },
  profileSecond: { color: PINK, marginLeft: 6, marginRight: 0 },
  swap: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  swapText: { color: BLUE, fontSize: 28, fontWeight: '700' },
  title: { color: '#F8FBFF', fontSize: 29, fontWeight: '800', letterSpacing: -0.8, marginTop: 10 },
});
