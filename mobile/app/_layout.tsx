import 'react-native-reanimated';

import { registerGlobals } from '@livekit/react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '../src/features/account/AuthProvider';
import { CallOverlay } from '../src/features/calling/CallOverlay';
import { ContactsProvider } from '../src/features/contacts/ContactsProvider';
import { LanguagePreferencesProvider } from '../src/features/languages/LanguagePreferencesProvider';

registerGlobals();

export default function RootLayout() {
  return (
    <AuthProvider>
      <LanguagePreferencesProvider>
        <ContactsProvider>
            <CallOverlay />
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
