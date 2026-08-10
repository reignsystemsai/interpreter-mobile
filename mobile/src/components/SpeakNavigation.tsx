import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
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
  return <Svg height={25} viewBox="0 0 24 24" width={25}><Path d="m3.5 11 8.5-7 8.5 7v8.5a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1V11Z" fill="none" stroke="#F8FBFF" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
}

function NavButton({ children, label, onPress, selected = false }: { children: ReactNode; label: string; onPress: () => void; selected?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const activate = () => {
    Vibration.vibrate(8);
    onPress();
  };
  return <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    hitSlop={10}
    onHoverIn={() => setHovered(true)}
    onHoverOut={() => setHovered(false)}
    onPress={activate}
    style={({ pressed }) => [styles.button, selected && styles.buttonSelected, hovered && styles.hovered, pressed && styles.pressed]}
  >{children}</Pressable>;
}

export function SpeakBottomBar({ onHome, onSpeak, onUtilities }: { onHome: () => void; onSpeak: () => void; onUtilities: () => void }) {
  return <View style={styles.bar}>
    <NavButton label="Speak tools" onPress={onSpeak}><Text style={styles.s}>S</Text></NavButton>
    <NavButton label="Home" onPress={onHome} selected><HomeIcon /></NavButton>
    <NavButton label="Utilities" onPress={onUtilities}><Text style={styles.plus}>+</Text></NavButton>
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
  bar: { alignItems: 'center', backgroundColor: '#020713', flexDirection: 'row', justifyContent: 'space-between', minHeight: 72, paddingBottom: 7, paddingHorizontal: 34, paddingTop: 5 },
  button: { alignItems: 'center', backgroundColor: 'rgba(4,16,38,0.72)', borderColor: 'rgba(38,160,255,0.58)', borderRadius: 27, borderWidth: 1, height: 54, justifyContent: 'center', shadowColor: '#0878FF', shadowOffset: { height: 0, width: 0 }, shadowOpacity: 0.18, shadowRadius: 8, width: 54 },
  buttonSelected: { borderColor: '#19D7FF', borderWidth: 2, shadowColor: '#19D7FF', shadowOpacity: 0.76, shadowRadius: 13 },
  hovered: { borderColor: '#19D7FF', shadowOpacity: 0.72, shadowRadius: 12, transform: [{ scale: 1.05 }] },
  s: { color: BLUE, fontSize: 27, fontWeight: '700' },
  plus: { color: BLUE, fontSize: 35, fontWeight: '300', marginTop: -3 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.93 }] },
});
