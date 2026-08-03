import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useFrameCallback,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

type AudioWaveformProps = {
  active: boolean;
  audioLevel: SharedValue<number>;
};

const BAR_HEIGHTS = [22, 42, 54, 78, 52, 42, 24];

function WaveBar({ active, audioLevel, baseHeight, index }: AudioWaveformProps & { baseHeight: number; index: number }) {
  const phase = useSharedValue(index * 0.7);

  useFrameCallback((frame) => {
    const delta = Math.min(frame.timeSincePreviousFrame ?? 16, 34) / 16;
    phase.value += delta * (active ? 0.09 + audioLevel.value * 0.1 : 0.025);
  });

  const animatedStyle = useAnimatedStyle(() => {
    const pulse = (Math.sin(phase.value) + 1) / 2;
    const scale = active ? 0.72 + pulse * 0.26 + audioLevel.value * 0.18 : 0.72;
    return { transform: [{ scaleY: scale }] };
  }, [active]);

  return <Animated.View style={[styles.bar, { height: baseHeight }, animatedStyle]} />;
}

export function AudioWaveform({ active, audioLevel }: AudioWaveformProps) {
  const activeValue = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    activeValue.value = active ? 1 : 0;
  }, [active, activeValue]);

  return (
    <View
      accessibilityLabel={
        active ? 'Live interpretation activity' : 'Idle audio line'
      }
      style={styles.container}
    >
      {BAR_HEIGHTS.map((height, index) => (
        <WaveBar active={active} audioLevel={audioLevel} baseHeight={height} index={index} key={height + index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 80,
    justifyContent: 'center',
  },
  bar: {
    backgroundColor: '#075BFF',
    borderRadius: 5,
    marginHorizontal: 3,
    width: 7,
  },
});
