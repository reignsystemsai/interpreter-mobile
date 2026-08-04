import 'react-native-reanimated';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '../src/features/account/AuthProvider';
import { ContactsProvider } from '../src/features/contacts/ContactsProvider';

export default function RootLayout() {
  return (
    <AuthProvider>
      <ContactsProvider>
        <StatusBar backgroundColor="#FFFFFF" style="dark" />
        <Stack
          screenOptions={{
            animation: 'none',
            contentStyle: { backgroundColor: '#FFFFFF' },
            headerShown: false,
          }}
        />
      </ContactsProvider>
    </AuthProvider>
  );
}
