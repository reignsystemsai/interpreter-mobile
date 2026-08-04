import type { PropsWithChildren } from 'react';

import { VoiceCallSurface } from './VoiceCallSurface';

export function CallProvider({ children }: PropsWithChildren) {
  return <>{children}<VoiceCallSurface /></>;
}
