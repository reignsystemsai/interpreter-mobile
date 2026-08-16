import 'react-native-reanimated';

import { registerGlobals } from '@livekit/react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { CallOverlay } from '../src/features/calling/CallOverlay';
import { ContactsProvider } from '../src/features/contacts/ContactsProvider';
import { LanguagePreferencesProvider } from '../src/features/languages/LanguagePreferencesProvider';
import { ApplyAvailableUpdate } from '../src/components/ApplyAvailableUpdate';

registerGlobals({ autoConfigureAudioSession: false });

export default function RootLayout() {
  return (
    <View style={styles.root}>
      <ApplyAvailableUpdate />
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
          <CallOverlay />
        </ContactsProvider>
      </LanguagePreferencesProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
