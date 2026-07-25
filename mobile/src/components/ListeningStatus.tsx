import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '../theme/colors';

type ListeningStatusProps = {
  active: boolean;
};

export function ListeningStatus({ active }: ListeningStatusProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const progress = withTiming(active ? 1 : 0, { duration: 360 });

    return {
      color: interpolateColor(
        progress,
        [0, 1],
        [colors.textMuted, colors.cyan],
      ),
      opacity: interpolate(progress, [0, 1], [0.72, 1]),
      transform: [
        {
          translateY: interpolate(progress, [0, 1], [0, -2]),
        },
      ],
    };
  }, [active]);

  return (
    <View accessibilityLiveRegion="polite" style={styles.container}>
      <Animated.Text style={[styles.status, animatedStyle]}>
        {active ? 'Listening…' : 'Tap to begin'}
      </Animated.Text>
      <Text style={styles.demoLabel}>
        {active ? 'SIMULATED SPEECH' : 'DEMO MODE'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    height: 52,
    marginTop: 2,
  },
  status: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  demoLabel: {
    color: '#4E5A72',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginTop: 10,
  },
});
