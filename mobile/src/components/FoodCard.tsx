import { Image } from 'expo-image';
import {
  Pressable,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { STATUS_META } from '../constants/status';
import { useTranslation } from '../i18n';
import { colors, palette, radius, shadows, spacing, statusColors } from '../theme';
import type { FoodCategory, FoodStatus } from '../types';
import { FoodStatusBadge } from './Badge';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { FreshnessScore } from './Score';
import { Body, Caption, Label, Subtitle, Title } from './Text';

/** Category icon, used as the placeholder when no photo exists. */
const CATEGORY_ICON: Record<FoodCategory, IconName> = {
  fruit: 'leaf',
  vegetable: 'leaf',
  meat: 'box',
  poultry: 'box',
  seafood: 'box',
  dairy: 'fridge',
  bakery: 'box',
  other: 'box',
};

interface FoodImageProps {
  uri: string | null;
  category?: FoodCategory;
  size?: number;
  rounded?: number;
  /** expo-image takes an ImageStyle, which ViewStyle is not assignable to. */
  style?: StyleProp<ImageStyle>;
}

/**
 * Food photo with a graceful placeholder.
 *
 * `expo-image` gives us disk caching and a fade-in for free, which matters on
 * the inventory list where the same photos are re-rendered constantly.
 */
export function FoodImage({
  uri,
  category = 'other',
  size = 64,
  rounded = radius.md,
  style,
}: FoodImageProps) {
  if (!uri) {
    return (
      <View
        style={[
          styles.placeholder,
          { width: size, height: size, borderRadius: rounded },
          style as StyleProp<ViewStyle>,
        ]}
      >
        <Icon name={CATEGORY_ICON[category]} size={size * 0.34} color={colors.secondary} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[{ width: size, height: size, borderRadius: rounded }, style]}
      contentFit="cover"
      transition={180}
      cachePolicy="disk"
      accessibilityIgnoresInvertColors
    />
  );
}

interface FoodCardProps {
  foodName: string;
  status: FoodStatus;
  category?: FoodCategory;
  imageUri?: string | null;
  /** Rendered under the name, e.g. "4 days remaining". */
  detail?: string;
  /** Rendered smaller below the detail, e.g. "Scanned 12 Mar". */
  meta?: string;
  score?: number | null;
  onPress?: () => void;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * The workhorse list row: image, name, status, detail.
 *
 * One accessibility label covers the whole row so a screen reader reads it as a
 * single item rather than five disconnected fragments.
 */
export function FoodCard({
  foodName,
  status,
  category = 'other',
  imageUri = null,
  detail,
  meta,
  score,
  onPress,
  trailing,
  style,
}: FoodCardProps) {
  const { t } = useTranslation();
  const statusLabel = t(STATUS_META[status].labelKey);
  const label = [foodName, statusLabel, detail, meta].filter(Boolean).join(', ');

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={label}
      style={[styles.foodCard, style]}
      padded={false}
    >
      <View style={styles.foodCardInner}>
        <FoodImage uri={imageUri} category={category} size={62} />
        <View style={styles.foodCardText}>
          <Label numberOfLines={1} style={styles.foodName}>
            {foodName}
          </Label>
          <FoodStatusBadge status={status} size="sm" style={styles.foodBadge} />
          {detail ? (
            <Caption style={styles.foodDetail} numberOfLines={1}>
              {detail}
            </Caption>
          ) : null}
          {meta ? <Caption numberOfLines={1}>{meta}</Caption> : null}
        </View>
        {trailing ?? (
          <View style={styles.foodTrailing}>
            {typeof score === 'number' ? (
              <FreshnessScore score={score} status={status} showBadge={false} />
            ) : null}
            {onPress ? <Icon name="forward" size={18} color={colors.textTertiary} /> : null}
          </View>
        )}
      </View>
    </Card>
  );
}

interface AttentionCardProps {
  foodName: string;
  status: FoodStatus;
  remaining: string;
  imageUri?: string | null;
  category?: FoodCategory;
  onPress?: () => void;
}

/**
 * Compact card for the "Needs your attention" carousel.
 *
 * Fixed width so it reads as a horizontally scrolling shelf rather than a list.
 */
export function AttentionCard({
  foodName,
  status,
  remaining,
  imageUri = null,
  category = 'other',
  onPress,
}: AttentionCardProps) {
  const { t } = useTranslation();
  const meta = STATUS_META[status];
  const tone = statusColors[status];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${foodName}, ${t(meta.labelKey)}, ${remaining}`}
      style={({ pressed }) => [styles.attention, pressed ? { opacity: 0.85 } : null]}
    >
      <View style={styles.attentionImageWrap}>
        <FoodImage uri={imageUri} category={category} size={148} rounded={radius.md} />
      </View>
      <Label numberOfLines={1} style={styles.attentionName}>
        {foodName}
      </Label>
      <View style={styles.attentionMeta}>
        <View style={[styles.dot, { backgroundColor: tone.fg }]} />
        <Caption numberOfLines={1} style={{ color: tone.fg }}>
          {t(meta.labelKey)}
        </Caption>
      </View>
      <Caption numberOfLines={1}>{remaining}</Caption>
    </Pressable>
  );
}

interface StatCardProps {
  value: string | number;
  label: string;
  tone?: 'fresh' | 'attention' | 'spoiled' | 'neutral';
  onPress?: () => void;
}

/** Small number block, used in the "YOUR FOOD" and "THIS WEEK" rows. */
export function StatCard({ value, label, tone = 'neutral', onPress }: StatCardProps) {
  const palette = {
    fresh: statusColors.fresh,
    attention: statusColors.nearly_spoiled,
    spoiled: statusColors.spoiled,
    neutral: { fg: colors.textPrimary, bg: colors.surface, border: colors.border },
  }[tone];

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.stat, { borderColor: palette.border }]}
      padded={false}
    >
      <View style={styles.statInner}>
        <Title color={palette.fg}>{value}</Title>
        <Caption numberOfLines={2} style={styles.statLabel}>
          {label}
        </Caption>
      </View>
    </Card>
  );
}

interface InfoCardProps {
  title: string;
  body: string | string[];
  icon?: IconName;
  tone?: 'sage' | 'surface' | 'warning' | 'sunken';
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Titled advisory block. Used for the storage recommendation ("Best next
 * step"), the "what should you do?" guidance, and analytics methodology.
 */
export function InfoCard({ title, body, icon, tone = 'surface', footer, style }: InfoCardProps) {
  const lines = Array.isArray(body) ? body : [body];
  const warning = tone === 'warning';

  return (
    <Card
      tone={tone === 'warning' ? 'surface' : tone}
      style={[warning ? styles.warningCard : null, style]}
    >
      <View style={styles.infoHeader}>
        {icon ? (
          <Icon name={icon} size={18} color={warning ? palette.amber600 : colors.primary} />
        ) : null}
        <Label style={styles.infoTitle}>{title}</Label>
      </View>
      {lines.map((line, index) => (
        <Body key={index} style={styles.infoLine}>
          {lines.length > 1 ? '• ' : ''}
          {line}
        </Body>
      ))}
      {footer}
    </Card>
  );
}

interface ShelfLifeCardProps {
  headline: string;
  detail: string;
  estimatedLabel: string;
  action: string;
  actionTitle: string;
}

/** The estimated-freshness-window block on the analysis screen. */
export function ShelfLifeCard({
  headline,
  detail,
  estimatedLabel,
  action,
  actionTitle,
}: ShelfLifeCardProps) {
  return (
    <Card tone="sage" style={styles.shelfCard}>
      <View style={styles.shelfHeader}>
        <Icon name="clock" size={16} color={colors.primary} />
        <Caption style={styles.shelfEyebrow}>{estimatedLabel}</Caption>
      </View>
      <Subtitle style={styles.shelfHeadline}>{headline}</Subtitle>
      <Body style={styles.shelfDetail}>{detail}</Body>
      <View style={styles.shelfDivider} />
      <Caption style={styles.shelfActionTitle}>{actionTitle}</Caption>
      <Body style={styles.shelfAction}>{action}</Body>
    </Card>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodCard: {
    marginBottom: spacing.md,
  },
  foodCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    padding: spacing.md,
  },
  foodCardText: {
    flex: 1,
    gap: 3,
  },
  foodName: {
    fontSize: 16.5,
  },
  foodBadge: {
    marginVertical: 2,
  },
  foodDetail: {
    color: colors.textSecondary,
  },
  foodTrailing: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  attention: {
    width: 148,
    gap: spacing.xs,
  },
  attentionImageWrap: {
    // The shadow lives on this wrapper because elevation (Android) is a
    // ViewStyle property and cannot be applied to an image style.
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    ...shadows.xs,
  },
  attentionName: {
    fontSize: 15.5,
  },
  attentionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  stat: {
    flex: 1,
  },
  statInner: {
    padding: spacing.base,
    gap: 2,
  },
  statLabel: {
    lineHeight: 15,
  },
  warningCard: {
    backgroundColor: palette.amber100,
    borderColor: palette.amber500,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  infoTitle: {
    flex: 1,
  },
  infoLine: {
    lineHeight: 22,
    marginBottom: 2,
  },
  shelfCard: {
    borderColor: colors.borderStrong,
  },
  shelfHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  shelfEyebrow: {
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    fontWeight: '700',
  },
  shelfHeadline: {
    marginTop: spacing.sm,
  },
  shelfDetail: {
    marginTop: 2,
    lineHeight: 21,
  },
  shelfDivider: {
    height: 1,
    backgroundColor: colors.borderStrong,
    marginVertical: spacing.base,
  },
  shelfActionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  shelfAction: {
    color: colors.textPrimary,
    lineHeight: 22,
  },
});

