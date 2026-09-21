import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { STATUS_META } from '../constants/status';
import { useTranslation } from '../i18n';
import { colors, palette, radius, spacing, statusColors } from '../theme';
import type { FoodStatus } from '../types';
import { FoodStatusBadge } from './Badge';
import { Body, Caption, Score as ScoreText, ScoreSmall } from './Text';

/**
 * Counts from 0 to `target` once, on mount.
 *
 * Implemented with a plain interval rather than Reanimated because the value
 * has to drive a *text* node; an animated SVG stroke and an animated number
 * cannot share one driver without a text-specific animated component. The
 * interval runs for ~700 ms and then stops.
 */
function useCountUp(target: number, durationMs = 700, enabled = true): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const frame = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }

    const steps = 28;
    const interval = Math.max(12, Math.round(durationMs / steps));
    let current = 0;

    frame.current = setInterval(() => {
      current += 1;
      const progress = current / steps;
      if (progress >= 1) {
        setValue(target);
        if (frame.current) clearInterval(frame.current);
        return;
      }
      // Ease-out so it decelerates into the final number.
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
    }, interval);

    return () => {
      if (frame.current) clearInterval(frame.current);
    };
  }, [target, durationMs, enabled]);

  return value;
}

interface ProgressRingProps {
  /** 0..1 */
  progress: number;
  size?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
}

/** Bare ring, for reuse wherever a circular proportion is needed. */
export function ProgressRing({
  progress,
  size = 180,
  thickness = 12,
  color = colors.primary,
  trackColor = colors.surfaceAlt,
  children,
}: ProgressRingProps) {
  const radiusPx = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radiusPx;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Rotate so the arc starts at 12 o'clock rather than 3 o'clock. */}
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radiusPx}
            stroke={trackColor}
            strokeWidth={thickness}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radiusPx}
            stroke={color}
            strokeWidth={thickness}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - clamped)}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      {children ? <View style={[styles.ringCentre, { width: size, height: size }]}>{children}</View> : null}
    </View>
  );
}

interface FreshnessScoreProps {
  score: number;
  status: FoodStatus;
  size?: number;
  /** Set false to skip the count-up (e.g. in a list). */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The hero score: a ring, the number, and the status badge.
 *
 * The whole group carries one accessibility label so a screen reader announces
 * "Freshness 92 out of 100, Fresh" rather than reading three fragments.
 */
export function CircularScore({
  score,
  status,
  size = 190,
  animate = true,
  style,
}: FreshnessScoreProps) {
  const { t } = useTranslation();
  const meta = STATUS_META[status];
  const tone = statusColors[status];
  const displayed = useCountUp(score, 700, animate);

  const label = `${t('analysis.detailsTitle')}: ${score} / 100, ${t(meta.labelKey)}`;

  return (
    <View
      style={[styles.circularWrap, style]}
      accessible
      accessibilityLabel={label}
      accessibilityRole="image"
    >
      <ProgressRing
        progress={score / 100}
        size={size}
        thickness={13}
        color={tone.fg}
        trackColor={tone.bg}
      >
        <ScoreText align="center">{displayed}</ScoreText>
        <Caption align="center" style={styles.outOf}>
          / 100
        </Caption>
      </ProgressRing>
      <FoodStatusBadge status={status} style={styles.circularBadge} />
    </View>
  );
}

/** Compact inline variant: "92 / 100" plus the badge, for cards and lists. */
export function FreshnessScore({
  score,
  status,
  showBadge = true,
}: {
  score: number;
  status: FoodStatus;
  showBadge?: boolean;
}) {
  const tone = statusColors[status];
  return (
    <View style={styles.inline}>
      <ScoreSmall color={tone.fg}>{score}</ScoreSmall>
      <Caption style={styles.inlineOutOf}>/ 100</Caption>
      {showBadge ? <FoodStatusBadge status={status} size="sm" /> : null}
    </View>
  );
}

interface BarProps {
  /** 0..1 */
  value: number;
  color?: string;
  height?: number;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
}

/** Horizontal bar used for the visual-metric rows. */
export function FreshnessProgressBar({
  value,
  color = colors.primary,
  height = 6,
  trackColor = colors.surfaceAlt,
  style,
}: BarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View
      style={[styles.track, { height, backgroundColor: trackColor, borderRadius: height }, style]}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height,
          backgroundColor: color,
          borderRadius: height,
        }}
      />
    </View>
  );
}

interface MetricRowProps {
  label: string;
  /** 0..1, or null when the backend could not measure it. */
  value: number | null;
  explanation?: string;
  /** True when a HIGH value is bad (defects, browning) rather than good. */
  inverted?: boolean;
  notMeasuredLabel: string;
}

/**
 * One measured metric.
 *
 * When `value` is null the bar is replaced with an explicit "not measured"
 * note -- Fresora never renders a zero bar for a metric it did not compute.
 */
export function MetricRow({
  label,
  value,
  explanation,
  inverted = false,
  notMeasuredLabel,
}: MetricRowProps) {
  if (value === null) {
    return (
      <View style={styles.metricRow}>
        <View style={styles.metricHeader}>
          <Body style={styles.metricLabel}>{label}</Body>
          <Caption>{notMeasuredLabel}</Caption>
        </View>
        {explanation ? <Caption style={styles.metricHint}>{explanation}</Caption> : null}
      </View>
    );
  }

  // A "good" reading fills the bar; an inverted metric fills as it worsens.
  const fill = inverted ? value : value;
  const quality = inverted ? 1 - value : value;
  const barColor =
    quality >= 0.7 ? colors.primary : quality >= 0.4 ? palette.amber500 : palette.red500;

  return (
    <View
      style={styles.metricRow}
      accessible
      accessibilityLabel={`${label}: ${Math.round(value * 100)}%`}
    >
      <View style={styles.metricHeader}>
        <Body style={styles.metricLabel}>{label}</Body>
        <Caption style={{ color: colors.textPrimary }}>{Math.round(value * 100)}%</Caption>
      </View>
      <FreshnessProgressBar value={fill} color={barColor} />
      {explanation ? <Caption style={styles.metricHint}>{explanation}</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circularWrap: {
    alignItems: 'center',
    gap: spacing.base,
  },
  ringCentre: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outOf: {
    marginTop: -6,
    letterSpacing: 1,
  },
  circularBadge: {
    alignSelf: 'center',
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  inlineOutOf: {
    marginRight: spacing.sm,
  },
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  metricRow: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metricLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  metricHint: {
    marginTop: 2,
    lineHeight: 16,
  },
});
