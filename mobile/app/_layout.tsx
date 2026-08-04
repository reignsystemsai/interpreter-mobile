import 'react-native-reanimated';

import { registerGlobals } from '@livekit/react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '../src/features/account/AuthProvider';
import { ContactsProvider } from '../src/features/contacts/ContactsProvider';
import { CallProvider } from '../src/features/calling/CallProvider';
import { DeviceRegistrationPrompt } from '../src/features/calling/DeviceRegistrationPrompt';
import { LanguagePreferencesProvider } from '../src/features/languages/LanguagePreferencesProvider';

registerGlobals();

export default function RootLayout() {
  return (
    <AuthProvider>
      <LanguagePreferencesProvider>
        <ContactsProvider>
          <CallProvider>
            <DeviceRegistrationPrompt />
            <StatusBar backgroundColor="#FFFFFF" style="dark" />
            <Stack
              screenOptions={{
                animation: 'none',
                contentStyle: { backgroundColor: '#FFFFFF' },
                headerShown: false,
              }}
            />
          </CallProvider>
        </ContactsProvider>
      </LanguagePreferencesProvider>
    </AuthProvider>
  );
}
