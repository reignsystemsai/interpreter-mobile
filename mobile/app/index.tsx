import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioWaveform } from '../src/components/AudioWaveform';
import { IlluminatedI } from '../src/components/IlluminatedI';
import { LanguageDisplay } from '../src/components/LanguageDisplay';
import { ListeningStatus } from '../src/components/ListeningStatus';
import { useDemoAudioLevel } from '../src/hooks/useDemoAudioLevel';
import { colors } from '../src/theme/colors';

export default function InterpreterScreen() {
  const [isListening, setIsListening] = useState(false);
  const audioLevel = useDemoAudioLevel(isListening);

  return (
    <View style={styles.page}>
      <LinearGradient
        colors={['#080D1C', '#040610', '#020308']}
        end={{ x: 0.76, y: 1 }}
        start={{ x: 0.12, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      <View pointerEvents="none" style={styles.ambientLightTop}>
        <LinearGradient
          colors={['rgba(81, 59, 255, 0.22)', 'rgba(19, 33, 92, 0)']}
          style={styles.ambientOrb}
        />
      </View>
      <View pointerEvents="none" style={styles.ambientLightBottom}>
        <LinearGradient
          colors={['rgba(0, 203, 255, 0.10)', 'rgba(0, 203, 255, 0)']}
          style={styles.ambientOrb}
        />
      </View>

      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.wordmarkDot} />
          <Text style={styles.wordmark}>INTERPRETER.AI</Text>
        </View>

        <View style={styles.centerStage}>
          <IlluminatedI
            active={isListening}
            onPress={() => setIsListening((current) => !current)}
          />
          <AudioWaveform active={isListening} audioLevel={audioLevel} />
          <ListeningStatus active={isListening} />
        </View>

        <LanguageDisplay languageOne="English" languageTwo="Auto Detect" />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
    overflow: 'hidden',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    paddingTop: 18,
  },
  wordmarkDot: {
    backgroundColor: colors.cyan,
    borderRadius: 3,
    height: 5,
    shadowColor: colors.cyan,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    width: 5,
  },
  wordmark: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.7,
  },
  centerStage: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 14,
  },
  ambientLightTop: {
    height: 480,
    position: 'absolute',
    right: -250,
    top: -260,
    transform: [{ rotate: '-16deg' }],
    width: 480,
  },
  ambientLightBottom: {
    bottom: -300,
    height: 500,
    left: -300,
    position: 'absolute',
    width: 500,
  },
  ambientOrb: {
    borderRadius: 250,
    flex: 1,
  },
});
