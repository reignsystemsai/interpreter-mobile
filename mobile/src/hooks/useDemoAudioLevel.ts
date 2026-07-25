import { useEffect } from 'react';
import {
  cancelAnimation,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export function useDemoAudioLevel(active: boolean): SharedValue<number> {
  const activeProgress = useSharedValue(0);
  const audioLevel = useSharedValue(0.035);
  const elapsed = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(activeProgress);
    activeProgress.value = withTiming(active ? 1 : 0, {
      duration: active ? 320 : 480,
    });
  }, [active, activeProgress]);

  useFrameCallback((frame) => {
    const delta = Math.min(frame.timeSincePreviousFrame ?? 16, 34);
    elapsed.value += delta / 1000;

    const t = elapsed.value;
    const simulatedSpeech =
      0.46 +
      Math.sin(t * 5.1) * 0.2 +
      Math.sin(t * 11.7 + 0.8) * 0.16 +
      Math.sin(t * 19.3 + 1.7) * 0.07;
    const clampedSpeech = Math.max(0.12, Math.min(0.96, simulatedSpeech));
    const idlePulse = 0.035 + (Math.sin(t * 1.45) + 1) * 0.012;
    const target =
      idlePulse + (clampedSpeech - idlePulse) * activeProgress.value;
    const responsiveness = 0.08 + activeProgress.value * 0.12;

    audioLevel.value += (target - audioLevel.value) * responsiveness;
  });

  return audioLevel;
}
