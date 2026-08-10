import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

const BLUE = '#0878FF';
const CYAN = '#19D7FF';

export type ReadyMode = 'connecting' | 'listening' | 'ready' | 'translating';

const DUST = Array.from({ length: 34 }, (_, index) => {
  const angle = (index / 34) * Math.PI * 2;
  const radius = 122 + (index % 4) * 4;
  return {
    height: index % 7 === 0 ? 5 : index % 3 === 0 ? 3 : 2,
    left: 138 + Math.cos(angle) * radius,
    top: 138 + Math.sin(angle) * radius,
    width: index % 7 === 0 ? 5 : index % 3 === 0 ? 3 : 2,
  };
});

function WaveBar({ active, height, index }: { active: boolean; height: number; index: number }) {
  const movement = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      movement.stopAnimation();
      Animated.timing(movement, { duration: 260, toValue: 0, useNativeDriver: true }).start();
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(index * 42),
      Animated.timing(movement, { duration: 180 + index * 18, toValue: 1, useNativeDriver: true }),
      Animated.timing(movement, { duration: 230 + (6 - index) * 16, toValue: 0.12, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, index, movement]);

  return <Animated.View style={[styles.waveBar, { height }, {
    opacity: movement.interpolate({ inputRange: [0, 1], outputRange: [0.64, 1] }),
    transform: [{ scaleY: movement.interpolate({ inputRange: [0, 1], outputRange: [0.58, 1.18] }) }],
  }]} />;
}

export function DynamicReadyOrb({ mode }: { mode: ReadyMode }) {
  const breath = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const voice = useRef(new Animated.Value(0)).current;
  const speckle = useRef(new Animated.Value(0)).current;
  const active = mode === 'listening' || mode === 'translating';

  useEffect(() => {
    const breathing = Animated.loop(Animated.sequence([
      Animated.timing(breath, { duration: mode === 'ready' ? 1800 : 760, toValue: 1, useNativeDriver: true }),
      Animated.timing(breath, { duration: mode === 'ready' ? 1800 : 620, toValue: 0, useNativeDriver: true }),
    ]));
    breathing.start();
    return () => breathing.stop();
  }, [breath, mode]);

  useEffect(() => {
    orbit.setValue(0);
    const duration = mode === 'ready' ? 18000 : mode === 'connecting' ? 6400 : mode === 'listening' ? 2800 : 4200;
    const rotation = Animated.loop(Animated.timing(orbit, {
      duration,
      easing: Easing.linear,
      toValue: 1,
      useNativeDriver: true,
    }));
    rotation.start();
    return () => rotation.stop();
  }, [mode, orbit]);

  useEffect(() => {
    voice.setValue(0);
    const rhythm = Animated.loop(Animated.sequence([
      Animated.timing(voice, { duration: active ? 190 : 1200, toValue: 1, useNativeDriver: true }),
      Animated.timing(voice, { duration: active ? 310 : 1200, toValue: 0.16, useNativeDriver: true }),
      Animated.timing(voice, { duration: active ? 130 : 900, toValue: 0.7, useNativeDriver: true }),
      Animated.timing(voice, { duration: active ? 370 : 1500, toValue: 0, useNativeDriver: true }),
    ]));
    rhythm.start();
    return () => rhythm.stop();
  }, [active, voice]);

  useEffect(() => {
    const dust = Animated.loop(Animated.sequence([
      Animated.timing(speckle, { duration: 2300, toValue: 1, useNativeDriver: true }),
      Animated.timing(speckle, { duration: 2600, toValue: 0.22, useNativeDriver: true }),
    ]));
    dust.start();
    return () => dust.stop();
  }, [speckle]);

  const label = mode === 'connecting' ? 'Connecting' : mode === 'listening' ? 'Listening' : mode === 'translating' ? 'Translating' : 'Ready';
  const rotate = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const brightness = voice.interpolate({ inputRange: [0, 1], outputRange: [0.52, 1] });

  return <View accessibilityLabel={`${label} interpreter`} accessibilityLiveRegion="polite" style={styles.container}>
    <Animated.View pointerEvents="none" style={[styles.dustField, {
      opacity: active ? speckle.interpolate({ inputRange: [0, 1], outputRange: [0.26, 0.78] }) : 0.22,
      transform: [{ rotate }],
    }]}>
      {DUST.map((dot, index) => <View key={index} style={[styles.dust, dot, index % 5 === 0 && styles.dustCyan]} />)}
    </Animated.View>
    <Animated.View pointerEvents="none" style={[styles.outerOrbit, {
      opacity: brightness,
      transform: [{ rotate }],
    }]}>
      <View style={styles.orbitGap} />
      <View style={styles.orbitNodeOne} />
      <View style={styles.orbitNodeTwo} />
    </Animated.View>
    <Animated.View pointerEvents="none" style={[styles.tickRing, {
      opacity: brightness,
      transform: [{ rotate: orbit.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] }) }],
    }]} />
    <Animated.View style={[styles.core, {
      opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }),
      transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.985, active ? 1.035 : 1.012] }) }],
    }]}>
      <View style={styles.wave}>
        {[28, 46, 65, 48, 56, 34, 24].map((height, index) => <WaveBar active={active} height={height} index={index} key={`${height}-${index}`} />)}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', height: 278, justifyContent: 'center', width: 278 },
  core: { alignItems: 'center', backgroundColor: '#020817', borderColor: BLUE, borderRadius: 91, borderWidth: 2, height: 182, justifyContent: 'center', shadowColor: CYAN, shadowOpacity: 0.72, shadowRadius: 18, width: 182 },
  dustField: { height: 276, left: 1, position: 'absolute', top: 1, width: 276 },
  dust: { backgroundColor: BLUE, borderRadius: 3, position: 'absolute' },
  dustCyan: { backgroundColor: CYAN },
  label: { color: '#F8FBFF', fontSize: 15, fontWeight: '600', marginTop: 10 },
  orbitGap: { backgroundColor: '#020713', height: 14, left: 24, position: 'absolute', top: -4, width: 50 },
  orbitNodeOne: { backgroundColor: CYAN, borderRadius: 4, height: 6, left: 21, position: 'absolute', top: 21, width: 6 },
  orbitNodeTwo: { backgroundColor: BLUE, borderRadius: 4, bottom: 20, height: 6, position: 'absolute', right: 20, width: 6 },
  outerOrbit: { borderColor: '#0D8CFF', borderRadius: 118, borderWidth: 1, height: 236, position: 'absolute', width: 236 },
  tickRing: { borderColor: CYAN, borderRadius: 105, borderStyle: 'dotted', borderWidth: 2, height: 210, position: 'absolute', width: 210 },
  wave: { alignItems: 'center', flexDirection: 'row', height: 68, justifyContent: 'center' },
  waveBar: { backgroundColor: BLUE, borderRadius: 5, marginHorizontal: 2.5, width: 5 },
});
