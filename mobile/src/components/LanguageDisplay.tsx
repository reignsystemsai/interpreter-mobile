import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';

type LanguageDisplayProps = {
  languageOne: string;
  languageTwo: string;
};

export function LanguageDisplay({
  languageOne,
  languageTwo,
}: LanguageDisplayProps) {
  return (
    <View accessibilityLabel={`${languageOne} to ${languageTwo}`} style={styles.wrap}>
      <View style={styles.rule} />
      <View style={styles.content}>
        <Text style={styles.language}>{languageOne}</Text>
        <Text style={styles.swap}>⇄</Text>
        <Text style={styles.language}>{languageTwo}</Text>
      </View>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    paddingBottom: 20,
  },
  rule: {
    backgroundColor: 'rgba(114, 136, 179, 0.18)',
    height: 1,
    maxWidth: 48,
    width: '12%',
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  language: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.4,
  },
  swap: {
    color: colors.violet,
    fontSize: 15,
    textShadowColor: 'rgba(135, 107, 255, 0.7)',
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 7,
  },
});
