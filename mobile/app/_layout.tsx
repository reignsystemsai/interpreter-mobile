import 'react-native-reanimated';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar backgroundColor="#FFFFFF" style="dark" />
      <Stack
        screenOptions={{
          animation: 'none',
          contentStyle: { backgroundColor: '#FFFFFF' },
          headerShown: false,
        }}
      />
    </>
  );
}
