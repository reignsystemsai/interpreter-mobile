import { useEffect } from 'react';
import * as Updates from 'expo-updates';

/** Applies an update downloaded by Expo's normal launch-time update check. */
export function ApplyAvailableUpdate() {
  const { isUpdatePending } = Updates.useUpdates();

  useEffect(() => {
    if (!isUpdatePending) return;
    void Updates.reloadAsync().catch(() => {
      // Keep the current working bundle if Expo cannot reload the update.
    });
  }, [isUpdatePending]);

  return null;
}
