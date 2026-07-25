import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';

import { colors } from '../theme/colors';

type AudioWaveformProps = {
  active: boolean;
  audioLevel: SharedValue<number>;
};

const AnimatedPath = Animated.createAnimatedComponent(Path);
const HEIGHT = 54;
const CENTER_Y = HEIGHT / 2;
const POINT_COUNT = 42;

function waveformPath(
  width: number,
  phase: number,
  level: number,
  active: boolean,
): string {
  'worklet';

  const amplitude = active ? 3 + level * 17 : 0.55 + level * 2.2;
  const points: Array<{ x: number; y: number }> = [];

  for (let index = 0; index <= POINT_COUNT; index += 1) {
    const x = (index / POINT_COUNT) * width;
    const envelope = Math.pow(Math.sin((Math.PI * x) / width), 1.65);
    const primary = Math.sin(index * 0.72 + phase);
    const detail = Math.sin(index * 1.31 - phase * 1.24) * 0.26;
    const y = CENTER_Y + (primary + detail) * amplitude * envelope;
    points.push({ x, y });
  }

  let path = `M ${points[0]?.x ?? 0} ${points[0]?.y ?? CENTER_Y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];

    if (!point || !next) {
      continue;
    }

    const midpointX = (point.x + next.x) / 2;
    const midpointY = (point.y + next.y) / 2;
    path += ` Q ${point.x} ${point.y} ${midpointX} ${midpointY}`;
  }

  const finalPoint = points[points.length - 1];
  if (finalPoint) {
    path += ` T ${finalPoint.x} ${finalPoint.y}`;
  }

  return path;
}

export function AudioWaveform({ active, audioLevel }: AudioWaveformProps) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth - 58, 340);
  const phase = useSharedValue(0);
  const activeValue = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    activeValue.value = active ? 1 : 0;
  }, [active, activeValue]);

  useFrameCallback((frame) => {
    const delta = Math.min(frame.timeSincePreviousFrame ?? 16, 34) / 16;
    const speed = active
      ? 0.07 + audioLevel.value * 0.13
      : 0.012 + audioLevel.value * 0.015;
    phase.value += speed * delta;
  });

  const animatedProps = useAnimatedProps(() => ({
    d: waveformPath(
      width,
      phase.value,
      audioLevel.value,
      activeValue.value > 0.5,
    ),
  }));

  return (
    <View
      accessibilityLabel={
        active ? 'Simulated speech activity waveform' : 'Idle audio line'
      }
      style={[styles.container, { width }]}
    >
      <Svg height={HEIGHT} width={width}>
        <Line
          opacity={0.65}
          stroke="rgba(88, 112, 164, 0.28)"
          strokeWidth={1}
          x1={0}
          x2={width}
          y1={CENTER_Y}
          y2={CENTER_Y}
        />
        <AnimatedPath
          animatedProps={animatedProps}
          fill="none"
          opacity={0.18}
          stroke={colors.blue}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={7}
        />
        <AnimatedPath
          animatedProps={animatedProps}
          fill="none"
          stroke={colors.cyan}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.35}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: HEIGHT,
    justifyContent: 'center',
    marginTop: -18,
  },
});
