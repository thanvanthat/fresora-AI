import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { GUTTER, colors, palette, radius, spacing } from '../theme';
import { Button } from './Button';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { Body, Caption, Subtitle } from './Text';

/**
 * Shimmering placeholder.
 *
 * Uses the Animated API rather than Reanimated: it is a looping opacity pulse
 * on a plain view, which the JS driver handles fine with `useNativeDriver`, and
 * it keeps skeletons usable in any screen without a worklet dependency.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  rounded = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: rounded,
          backgroundColor: colors.surfaceAlt,
          opacity: pulse,
        },
        style,
      ]}
      aria-hidden
    />
  );
}

/** Card-shaped skeleton matching the FoodCard layout. */
export function SkeletonCard() {
  return (
    <Card style={styles.skeletonCard}>
      <View style={styles.skeletonRow}>
        <Skeleton width={64} height={64} rounded={radius.md} />
        <View style={styles.skeletonLines}>
          <Skeleton width="55%" height={18} />
          <Skeleton width="35%" height={13} />
          <Skeleton width="45%" height={13} />
        </View>
      </View>
    </Card>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon = 'leaf',
  title,
  body,
  actionLabel,
  onAction,
  style,
}: EmptyStateProps) {
  return (
    <View style={[styles.centred, style]}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={colors.secondary} />
      </View>
      <Subtitle align="center" heading>
        {title}
      </Subtitle>
      {body ? (
        <Body align="center" style={styles.centredBody}>
          {body}
        </Body>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} fullWidth={false} style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

interface LoadingStateProps {
  message?: string;
  style?: StyleProp<ViewStyle>;
}

export function LoadingState({ message, style }: LoadingStateProps) {
  return (
    <View style={[styles.centred, style]} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.primary} size="large" />
      {message ? (
        <Body align="center" style={styles.centredBody}>
          {message}
        </Body>
      ) : null}
    </View>
  );
}

interface ErrorStateProps {
  title: string;
  body?: string;
  retryLabel?: string;
  onRetry?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  /** Secondary escape hatch, e.g. "pick from gallery instead". */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/**
 * Error presentation.
 *
 * Takes already-translated, human-readable copy. Raw messages and stack traces
 * never reach this component -- the API client maps error codes to dictionary
 * keys before anything is displayed (rule 37).
 */
export function ErrorState({
  title,
  body,
  retryLabel,
  onRetry,
  icon = 'alert-triangle',
  style,
  secondaryLabel,
  onSecondary,
}: ErrorStateProps) {
  return (
    <View style={[styles.centred, style]} accessibilityRole="alert">
      <View style={[styles.emptyIcon, styles.errorIcon]}>
        <Icon name={icon} size={26} color="#B4463F" />
      </View>
      <Subtitle align="center" heading>
        {title}
      </Subtitle>
      {body ? (
        <Body align="center" style={styles.centredBody}>
          {body}
        </Body>
      ) : null}
      <View style={styles.errorActions}>
        {retryLabel && onRetry ? (
          <Button label={retryLabel} onPress={onRetry} fullWidth={false} />
        ) : null}
        {secondaryLabel && onSecondary ? (
          <Button
            label={secondaryLabel}
            onPress={onSecondary}
            variant="secondary"
            fullWidth={false}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The food-safety notice.
 *
 * Deliberately its own component so the wording is identical everywhere it
 * appears and can never drift into a safety claim in one place.
 */
export function SafetyNotice({
  text,
  compact = false,
  style,
}: {
  text: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.safety, compact ? styles.safetyCompact : null, style]}>
      <Icon name="info" size={14} color={colors.textTertiary} />
      <Caption style={styles.safetyText}>{text}</Caption>
    </View>
  );
}

/** Offline banner, pinned under the header when connectivity drops. */
export function OfflineBanner({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.offline} accessibilityRole="alert">
      <Icon name="wifi" size={15} color="#C8880E" />
      <View style={styles.offlineText}>
        <Caption style={styles.offlineTitle}>{title}</Caption>
        {body ? <Caption>{body}</Caption> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.huge,
    paddingHorizontal: GUTTER,
    gap: spacing.md,
  },
  centredBody: {
    maxWidth: 320,
    lineHeight: 22,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  errorIcon: {
    backgroundColor: palette.red100,
  },
  errorActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  emptyAction: {
    marginTop: spacing.sm,
  },
  skeletonCard: {
    marginBottom: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing.base,
    alignItems: 'center',
  },
  skeletonLines: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonList: {
    paddingHorizontal: GUTTER,
  },
  safety: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  safetyCompact: {
    padding: spacing.md,
  },
  safetyText: {
    flex: 1,
    lineHeight: 17,
  },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: GUTTER,
    marginBottom: spacing.base,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.amber100,
    borderWidth: 1,
    borderColor: palette.amber500,
  },
  offlineText: {
    flex: 1,
  },
  offlineTitle: {
    color: palette.amber600,
    fontWeight: '700',
  },
});
