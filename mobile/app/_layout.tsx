import 'react-native-reanimated';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          animation: 'none',
          contentStyle: { backgroundColor: '#03040A' },
          headerShown: false,
        }}
      />
    </>
  );
}
