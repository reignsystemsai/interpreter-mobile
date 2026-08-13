import type { PropsWithChildren } from 'react';
import { View } from 'react-native';

export function CallingSetupGate({ children }: PropsWithChildren) {
  return <View>{children}</View>;
}
