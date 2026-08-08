import 'react-native-reanimated';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '../src/features/account/AuthProvider';
import { ContactsProvider } from '../src/features/contacts/ContactsProvider';
import { LanguagePreferencesProvider } from '../src/features/languages/LanguagePreferencesProvider';

export default function RootLayout() {
  return (
    <AuthProvider>
      <LanguagePreferencesProvider>
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
      </LanguagePreferencesProvider>
    </AuthProvider>
  );
}
