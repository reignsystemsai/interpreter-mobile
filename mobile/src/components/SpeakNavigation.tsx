import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const BLUE = '#075BFF';

export function SpeakMark({ compact = false }: { compact?: boolean }) {
  return <View accessibilityLabel="Speak" style={styles.markWrap}>
    <Text style={[styles.mark, compact && styles.markCompact]}>S</Text>
    <View style={[styles.spark, compact && styles.sparkCompact]} />
    <View style={[styles.spark, styles.sparkSecond, compact && styles.sparkSecondCompact]} />
  </View>;
}

function HomeIcon() {
  return <Svg height={22} viewBox="0 0 24 24" width={22}><Path d="m3.5 11 8.5-7 8.5 7v8.5a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1V11Z" fill="none" stroke={BLUE} strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
}

export function SpeakBottomBar({ onHome, onSpeak, onUtilities }: { onHome: () => void; onSpeak: () => void; onUtilities: () => void }) {
  return <View style={styles.bar}>
    <Pressable accessibilityLabel="Speak tools" hitSlop={10} onPress={onSpeak} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><Text style={styles.s}>S</Text></Pressable>
    <Pressable accessibilityLabel="Home" hitSlop={10} onPress={onHome} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><HomeIcon /></Pressable>
    <Pressable accessibilityLabel="Utilities" hitSlop={10} onPress={onUtilities} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><Text style={styles.plus}>+</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  markWrap: { alignItems: 'center', alignSelf: 'center', justifyContent: 'center', minHeight: 44, minWidth: 48, position: 'relative' },
  mark: { color: BLUE, fontSize: 42, fontWeight: '800', letterSpacing: -2 },
  markCompact: { fontSize: 29, letterSpacing: -1 },
  spark: { backgroundColor: BLUE, borderRadius: 2, height: 5, position: 'absolute', right: 4, top: 4, transform: [{ rotate: '38deg' }], width: 2 },
  sparkCompact: { height: 4, right: 7, top: 6 },
  sparkSecond: { height: 2, right: 0, top: 12, transform: [{ rotate: '-18deg' }], width: 4 },
  sparkSecondCompact: { right: 4, top: 12 },
  bar: { alignItems: 'center', backgroundColor: '#FFFFFF', flexDirection: 'row', justifyContent: 'space-between', minHeight: 62, paddingHorizontal: 20, paddingVertical: 7 },
  button: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E2EAF7', borderRadius: 20, borderWidth: 1, height: 40, justifyContent: 'center', shadowColor: '#075BFF', shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.09, shadowRadius: 8, width: 40 },
  s: { color: BLUE, fontSize: 21, fontWeight: '700' },
  plus: { color: BLUE, fontSize: 28, fontWeight: '300', marginTop: -2 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.96 }] },
});
