/**
 * Manual UI controls.
 *
 * Change only these values when tuning the main screen layout. Measurements
 * are React Native density-independent pixels unless noted otherwise.
 */
export const UI_CONTROLS = {
  layout: {
    compactHeightBreakpoint: 780,
    screen: {
      paddingTop: 20,
      paddingHorizontal: 24,
      paddingHorizontalCompact: 18,
      paddingBottom: 22,
      paddingBottomCompact: 14,
    },
    header: {
      buttonSize: 48,
      insetHorizontal: 12,
      insetTop: 8,
    },
    hero: {
      marginTop: 24,
      marginTopCompact: 10,
      logoSize: 105,
      logoSizeCompact: 88,
    },
    listeningOrb: {
      marginTop: 20,
      marginTopCompact: 10,
      stageSize: 248,
      stageSizeCompact: 188,
      orbSize: 224,
      orbSizeCompact: 168,
      ringSize: 196,
      ringSizeCompact: 144,
    },
    languageSetup: {
      maxWidth: 520,
      marginTop: 20,
      marginTopCompact: 10,
      sectionGap: 16,
      sectionGapCompact: 10,
      rowGap: 8,
      rowGapCompact: 5,
      fieldHeight: 49,
    },
    primaryAction: {
      maxWidth: 480,
      widthPercent: '84%',
      height: 62,
    },
  },
} as const;
