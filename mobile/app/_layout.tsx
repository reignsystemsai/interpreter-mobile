import 'react-native-reanimated';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '../src/features/account/AuthProvider';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar backgroundColor="#FFFFFF" style="dark" />
      <Stack
        screenOptions={{
          animation: 'none',
          contentStyle: { backgroundColor: '#FFFFFF' },
          headerShown: false,
        }}
      />
    </AuthProvider>
  );
}
