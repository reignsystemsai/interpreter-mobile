import 'react-native-reanimated';

import { registerGlobals } from '@livekit/react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '../src/features/account/AuthProvider';
import { CallableIdentityGate } from '../src/features/account/CallableIdentityGate';
import { CallOverlay } from '../src/features/calling/CallOverlay';
import { ContactsProvider } from '../src/features/contacts/ContactsProvider';
import { LanguagePreferencesProvider } from '../src/features/languages/LanguagePreferencesProvider';
import { ApplyAvailableUpdate } from '../src/components/ApplyAvailableUpdate';

registerGlobals();

export default function RootLayout() {
  return (
    <AuthProvider>
      <CallableIdentityGate>
        <ApplyAvailableUpdate />
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
      </CallableIdentityGate>
    </AuthProvider>
  );
}
