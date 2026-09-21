import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { STATUS_META } from '../constants/status';
import { useTranslation } from '../i18n';
import { colors, radius, spacing, statusColors } from '../theme';
import type { FoodStatus } from '../types';
import { Icon } from './Icon';
import { Caption, LabelSm } from './Text';

interface StatusBadgeProps {
  status: FoodStatus;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

/**
 * Status pill.
 *
 * Deliberately carries an icon AND a text label alongside the colour, so the
 * status is never communicated by hue alone (accessibility requirement 38).
 */
export function FoodStatusBadge({ status, size = 'md', style }: StatusBadgeProps) {
  const { t } = useTranslation();
  const meta = STATUS_META[status];
  const tone = statusColors[status];
  const small = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: tone.bg,
          borderColor: tone.border,
          paddingVertical: small ? 3 : 5,
          paddingHorizontal: small ? spacing.sm : spacing.md,
        },
        style,
      ]}
    >
      <Icon name={meta.icon} size={small ? 11 : 13} color={tone.fg} />
      <LabelSm style={{ color: tone.fg, fontSize: small ? 11 : 12.5 }}>
        {t(meta.labelKey)}
      </LabelSm>
    </View>
  );
}

interface ConfidenceBadgeProps {
  /** 0..1 from the model. */
  confidence: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Model confidence. Distinct from the freshness score on purpose: one is how
 * sure we are *what* the food is, the other is what condition it is in. Showing
 * them in different shapes keeps them from being read as the same number.
 */
export function ConfidenceBadge({ confidence, style }: ConfidenceBadgeProps) {
  const { t } = useTranslation();
  const percent = Math.round(confidence * 100);

  return (
    <View style={[styles.confidence, style]}>
      <Icon name="sparkle" size={12} color={colors.textOnPrimary} />
      <LabelSm style={styles.confidenceText}>
        {t('analysis.confidence')} {percent}%
      </LabelSm>
    </View>
  );
}

interface PillProps {
  label: string;
  tone?: 'neutral' | 'sage' | 'warning' | 'info';
  icon?: Parameters<typeof Icon>[0]['name'];
  style?: StyleProp<ViewStyle>;
}

/** Generic informational pill (storage mode, category, "Estimated"). */
export function Pill({ label, tone = 'neutral', icon, style }: PillProps) {
  const palette = {
    neutral: { bg: colors.surfaceSunken, fg: colors.textSecondary, border: colors.border },
    sage: statusColors.fresh,
    warning: statusColors.nearly_spoiled,
    info: statusColors.processing,
  }[tone];

  return (
    <View
      style={[styles.pill, { backgroundColor: palette.bg, borderColor: palette.border }, style]}
    >
      {icon ? <Icon name={icon} size={12} color={palette.fg} /> : null}
      <Caption style={{ color: palette.fg }}>{label}</Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  confidence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.scrim,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  confidenceText: {
    color: colors.textOnPrimary,
    fontSize: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    alignSelf: 'flex-start',
  },
});
