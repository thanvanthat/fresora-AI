import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Display, Body } from '../../components/Text';
import { useTranslation } from '../../i18n';
import { colors, spacing } from '../../theme';

/**
 * The Fresora leaf mark, drawn as SVG.
 *
 * Inline rather than a PNG so it scales cleanly and picks up theme colours.
 * Two shapes: the leaf body and the midrib.
 */
export function LeafMark({ size = 56, color = colors.primary }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      {/* Leaf body: a lens shape formed by two opposing arcs. */}
      <Path
        d="M24 4C13 9 7 18 7 28c0 8 5 14 12 15 1-11 5-20 13-27C28 12 25 8 24 4Z"
        fill={color}
        opacity={0.9}
      />
      <Path
        d="M24 4c11 5 17 14 17 24 0 8-5 14-12 15-1-11-5-20-13-27 4-4 7-8 8-12Z"
        fill={color}
        opacity={0.55}
      />
      {/* Midrib. */}
      <Path
        d="M24 43C24 30 24 16 24 4"
        stroke={colors.surface}
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.75}
      />
    </Svg>
  );
}

/**
 * Branded splash.
 *
 * Shown while the app boots, and again as the loading state for the entry
 * route. The animation is a single fade plus a small rise -- enough to feel
 * considered, short enough that nobody waits for it (rule 9: no excessive
 * animated intro).
 */
export function SplashBrand() {
  const { t } = useTranslation();
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, rise]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.content, { opacity: fade, transform: [{ translateY: rise }] }]}
      >
        <LeafMark size={62} />
        <Display align="center" style={styles.name}>
          {t('common.appName')}
        </Display>
        <Body align="center" style={styles.tagline}>
          {t('common.tagline')}
        </Body>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    gap: spacing.md,
  },
  name: {
    marginTop: spacing.base,
  },
  tagline: {
    maxWidth: 240,
  },
});
