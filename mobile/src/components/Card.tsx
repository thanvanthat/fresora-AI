import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { GUTTER, colors, radius, shadows, spacing } from '../theme';
import { Eyebrow } from './Text';

interface CardProps {
  children: ReactNode;
  /** Makes the whole card a single tappable target. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  padded?: boolean;
  tone?: 'surface' | 'sage' | 'sunken';
  style?: StyleProp<ViewStyle>;
  elevation?: 'none' | 'xs' | 'sm' | 'md';
}

/**
 * The base surface: large radius, hairline border, very soft shadow. Every
 * panel in the app is this card, so the editorial rhythm stays consistent.
 */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  padded = true,
  tone = 'surface',
  style,
  elevation = 'xs',
}: CardProps) {
  const background =
    tone === 'sage'
      ? colors.surfaceAlt
      : tone === 'sunken'
        ? colors.surfaceSunken
        : colors.surface;

  const content = (
    <View
      style={[
        styles.card,
        { backgroundColor: background },
        padded ? styles.padded : null,
        shadows[elevation],
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {content}
    </Pressable>
  );
}

/** A titled block with the standard page gutter and vertical rhythm. */
interface SectionProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Set false for horizontally scrolling content that bleeds to the edge. */
  gutter?: boolean;
}

export function Section({
  title,
  action,
  children,
  style,
  gutter = true,
}: SectionProps) {
  return (
    <View style={[styles.section, style]}>
      {title || action ? (
        <View style={[styles.sectionHeader, gutter ? styles.sectionGutter : null]}>
          {title ? <Eyebrow>{title}</Eyebrow> : <View />}
          {action}
        </View>
      ) : null}
      <View style={gutter ? styles.sectionGutter : null}>{children}</View>
    </View>
  );
}

/** Horizontal hairline. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/** Evenly spaced row of small stat blocks, as used under "YOUR FOOD". */
export function StatRow({ children }: { children: ReactNode }) {
  return <View style={styles.statRow}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  padded: {
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.995 }],
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionGutter: {
    paddingHorizontal: GUTTER,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
});
