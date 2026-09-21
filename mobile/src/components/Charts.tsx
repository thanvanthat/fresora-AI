import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';

import { colors, radius, spacing } from '../theme';
import { Card } from './Card';
import { Body, Caption, Label } from './Text';

/**
 * Charts drawn directly with react-native-svg.
 *
 * A charting library would bring a large dependency and its own visual
 * language; these four shapes are the whole requirement, and drawing them here
 * keeps them on the app's own palette and type scale.
 *
 * Every chart is paired with an accessible text summary, because an SVG on its
 * own tells a screen-reader user nothing.
 */

export interface ChartDatum {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: ChartDatum[];
  height?: number;
  /** Shown when every value is zero. */
  emptyLabel: string;
}

/** Horizontal bars with the value at the end. Good for category counts. */
export function BarChart({ data, emptyLabel }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 0);

  if (max === 0) {
    return <Caption style={styles.empty}>{emptyLabel}</Caption>;
  }

  return (
    <View
      style={styles.bars}
      accessible
      accessibilityLabel={data.map((d) => `${d.label}: ${d.value}`).join(', ')}
    >
      {data.map((datum) => (
        <View key={datum.label} style={styles.barRow}>
          <Caption numberOfLines={1} style={styles.barLabel}>
            {datum.label}
          </Caption>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.max((datum.value / max) * 100, datum.value > 0 ? 3 : 0)}%`,
                  backgroundColor: datum.color ?? colors.primary,
                },
              ]}
            />
          </View>
          <Caption style={styles.barValue}>{datum.value}</Caption>
        </View>
      ))}
    </View>
  );
}

interface DonutProps {
  data: ChartDatum[];
  size?: number;
  thickness?: number;
  centreValue?: string;
  centreLabel?: string;
  emptyLabel: string;
}

/**
 * Donut for the freshness distribution.
 *
 * Each slice is a stroked arc on the same circle, offset by the running total,
 * which avoids computing arc paths by hand.
 */
export function DonutChart({
  data,
  size = 150,
  thickness = 22,
  centreValue,
  centreLabel,
  emptyLabel,
}: DonutProps) {
  const total = data.reduce((sum, datum) => sum + datum.value, 0);

  if (total === 0) {
    return <Caption style={styles.empty}>{emptyLabel}</Caption>;
  }

  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <View
      style={styles.donutWrap}
      accessible
      accessibilityLabel={data
        .filter((d) => d.value > 0)
        .map((d) => `${d.label}: ${Math.round((d.value / total) * 100)} percent`)
        .join(', ')}
    >
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            {data.map((datum) => {
              if (datum.value <= 0) return null;
              const fraction = datum.value / total;
              const dash = circumference * fraction;
              const element = (
                <Circle
                  key={datum.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={datum.color ?? colors.primary}
                  strokeWidth={thickness}
                  fill="none"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return element;
            })}
          </G>
        </Svg>
        {centreValue ? (
          <View style={[styles.donutCentre, { width: size, height: size }]}>
            <Label style={styles.donutValue}>{centreValue}</Label>
            {centreLabel ? <Caption>{centreLabel}</Caption> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.legend}>
        {data
          .filter((datum) => datum.value > 0)
          .map((datum) => (
            <View key={datum.label} style={styles.legendRow}>
              <View
                style={[styles.legendDot, { backgroundColor: datum.color ?? colors.primary }]}
              />
              <Caption style={styles.legendLabel} numberOfLines={1}>
                {datum.label}
              </Caption>
              <Caption style={styles.legendValue}>{datum.value}</Caption>
            </View>
          ))}
      </View>
    </View>
  );
}

interface TimeSeriesProps {
  points: Array<{ label: string; value: number }>;
  height?: number;
  color?: string;
  emptyLabel: string;
}

/** Column chart over time, for scans per day. */
export function ColumnChart({
  points,
  height = 120,
  color = colors.primary,
  emptyLabel,
}: TimeSeriesProps) {
  const max = Math.max(...points.map((p) => p.value), 0);

  if (points.length === 0 || max === 0) {
    return <Caption style={styles.empty}>{emptyLabel}</Caption>;
  }

  const gap = 4;
  const width = 300;
  const barWidth = Math.max(3, (width - gap * (points.length - 1)) / points.length);

  return (
    <View
      accessible
      accessibilityLabel={points.map((p) => `${p.label}: ${p.value}`).join(', ')}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke={colors.border}
          strokeWidth={1}
        />
        {points.map((point, index) => {
          const barHeight = point.value === 0 ? 0 : Math.max((point.value / max) * (height - 8), 3);
          return (
            <Rect
              key={`${point.label}-${index}`}
              x={index * (barWidth + gap)}
              y={height - barHeight - 1}
              width={barWidth}
              height={barHeight}
              rx={Math.min(3, barWidth / 2)}
              fill={color}
            />
          );
        })}
      </Svg>
      <View style={styles.axis}>
        <Caption>{points[0]?.label}</Caption>
        <Caption>{points[points.length - 1]?.label}</Caption>
      </View>
    </View>
  );
}

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

/** Tiny trend line, used on the freshness-journey timeline. */
export function Sparkline({
  values,
  width = 88,
  height = 28,
  color = colors.primary,
}: SparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);

  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <Svg width={width} height={height} aria-hidden>
      <Path d={path} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** Titled chart container. */
export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card style={styles.chartCard}>
      <Label style={styles.chartTitle}>{title}</Label>
      {subtitle ? <Caption style={styles.chartSubtitle}>{subtitle}</Caption> : null}
      {children}
    </Card>
  );
}

/** Big number with a label, for the analytics KPI grid. */
export function MetricCard({
  value,
  label,
  caption,
  tone = colors.textPrimary,
}: {
  value: string | number;
  label: string;
  caption?: string;
  tone?: string;
}) {
  return (
    <Card style={styles.metricCard} accessibilityLabel={`${label}: ${value}`}>
      <Body style={styles.metricCardValue} color={tone}>
        {value}
      </Body>
      <Caption numberOfLines={2}>{label}</Caption>
      {caption ? <Caption style={styles.metricCardCaption}>{caption}</Caption> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  bars: {
    gap: spacing.md,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  barLabel: {
    width: 82,
  },
  barTrack: {
    flex: 1,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  barFill: {
    height: 9,
    borderRadius: 5,
  },
  barValue: {
    width: 30,
    textAlign: 'right',
    color: colors.textPrimary,
  },
  donutWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  donutCentre: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutValue: {
    fontSize: 20,
  },
  legend: {
    flex: 1,
    gap: spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  legendLabel: {
    flex: 1,
  },
  legendValue: {
    color: colors.textPrimary,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  chartCard: {
    marginBottom: spacing.base,
  },
  chartTitle: {
    marginBottom: 2,
  },
  chartSubtitle: {
    marginBottom: spacing.base,
  },
  metricCard: {
    flex: 1,
    minWidth: 140,
    gap: 2,
  },
  metricCardValue: {
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '600',
  },
  metricCardCaption: {
    marginTop: 2,
    fontStyle: 'italic',
  },
});
