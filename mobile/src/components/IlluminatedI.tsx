import { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '../theme/colors';

type IlluminatedIProps = {
  active: boolean;
  onPress: (event: GestureResponderEvent) => void;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function IlluminatedI({ active, onPress }: IlluminatedIProps) {
  const breath = useSharedValue(0);
  const activeProgress = useSharedValue(active ? 1 : 0);
  const pressed = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(breath);
    breath.value = 0;
    breath.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: active ? 950 : 2200,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(0, {
          duration: active ? 950 : 2200,
          easing: Easing.inOut(Easing.sin),
        }),
      ),
      -1,
    );

    activeProgress.value = withTiming(active ? 1 : 0, { duration: 420 });
  }, [active, activeProgress, breath]);

  const pressableStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressed.value }],
  }));

  const outerGlowStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(breath.value, [0, 1], [0.22, 0.48]) +
      activeProgress.value * 0.16,
    transform: [
      {
        scale:
          interpolate(breath.value, [0, 1], [0.9, 1.08]) +
          activeProgress.value * 0.025,
      },
    ],
  }));

  const innerGlowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(breath.value, [0, 1], [0.52, 0.82]),
    transform: [
      {
        scale: interpolate(breath.value, [0, 1], [0.97, 1.025]),
      },
    ],
  }));

  const handlePressIn = () => {
    pressed.value = withSpring(0.965, { damping: 18, stiffness: 280 });
  };

  const handlePressOut = () => {
    pressed.value = withSpring(1, { damping: 16, stiffness: 240 });
  };

  return (
    <AnimatedPressable
      accessibilityHint="Starts or stops live voice interpretation"
      accessibilityLabel={
        active ? 'Stop live interpretation' : 'Begin live interpretation'
      }
      accessibilityRole="button"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.touchTarget, pressableStyle]}
    >
      <Animated.View pointerEvents="none" style={[styles.outerGlow, outerGlowStyle]}>
        <LinearGradient
          colors={[
            'rgba(55, 125, 255, 0)',
            'rgba(104, 82, 255, 0.64)',
            'rgba(113, 238, 255, 0)',
          ]}
          end={{ x: 0.85, y: 0.92 }}
          start={{ x: 0.14, y: 0.06 }}
          style={styles.glowFill}
        />
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.innerGlow, innerGlowStyle]}>
        <LinearGradient
          colors={['rgba(52, 94, 255, 0.22)', 'rgba(130, 92, 255, 0.32)']}
          style={styles.glowFill}
        />
      </Animated.View>

      <View pointerEvents="none" style={styles.letterStage}>
        <Text style={styles.letterDepth}>I</Text>
        <Text style={styles.letterMain}>I</Text>
        <LinearGradient
          colors={[
            'rgba(255,255,255,0.72)',
            'rgba(113,238,255,0.22)',
            'rgba(255,255,255,0)',
          ]}
          style={styles.edgeLight}
        />
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  touchTarget: {
    alignItems: 'center',
    height: 278,
    justifyContent: 'center',
    width: 278,
  },
  outerGlow: {
    borderRadius: 139,
    height: 278,
    position: 'absolute',
    width: 278,
  },
  innerGlow: {
    borderColor: 'rgba(129, 150, 255, 0.12)',
    borderRadius: 91,
    borderWidth: 1,
    height: 182,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: colors.violet,
    shadowOpacity: 0.48,
    shadowRadius: 34,
    width: 182,
  },
  glowFill: {
    borderRadius: 999,
    flex: 1,
  },
  letterStage: {
    alignItems: 'center',
    height: 170,
    justifyContent: 'center',
    width: 112,
  },
  letterDepth: {
    color: '#5043C8',
    fontSize: 166,
    fontWeight: '300',
    left: 4,
    letterSpacing: -8,
    lineHeight: 170,
    position: 'absolute',
    textShadowColor: 'rgba(75, 63, 255, 0.9)',
    textShadowOffset: { height: 3, width: 0 },
    textShadowRadius: 22,
    top: 2,
  },
  letterMain: {
    color: '#EAFDFF',
    fontSize: 166,
    fontWeight: '300',
    letterSpacing: -8,
    lineHeight: 170,
    position: 'absolute',
    textShadowColor: 'rgba(92, 222, 255, 0.95)',
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 16,
    top: 0,
  },
  edgeLight: {
    borderRadius: 2,
    height: 116,
    left: 46,
    opacity: 0.72,
    position: 'absolute',
    top: 26,
    width: 2,
  },
});
