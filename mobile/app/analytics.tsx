import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Section, StatRow } from '../src/components/Card';
import {
  BarChart,
  ChartCard,
  ColumnChart,
  DonutChart,
  MetricCard,
  type ChartDatum,
} from '../src/components/Charts';
import { SegmentedControl, type SegmentOption } from '../src/components/Controls';
import { InfoCard } from '../src/components/FoodCard';
import { Gutter, Screen } from '../src/components/Screen';
import { EmptyState, LoadingState } from '../src/components/States';
import { useAnalytics } from '../src/hooks/useAnalytics';
import { useTranslation } from '../src/i18n';
import type { AnalyticsRange } from '../src/utils/inventory';
import { colors, spacing, statusColors } from '../src/theme';

/**
 * Analytics.
 *
 * Every figure is computed from the user's own rows and the methodology is
 * stated on the screen. There is no money-saved or carbon-saved number, because
 * Fresora has no price or emissions data and inventing one would be the most
 * tempting dishonesty in the whole app (rule 28).
 */
export default function AnalyticsScreen() {
  const { t } = useTranslation();
  const [range, setRange] = useState<AnalyticsRange>(30);

  const { data, isLoading } = useAnalytics(range);

  const options: SegmentOption<string>[] = [
    { value: '7', label: t('analytics.range7') },
    { value: '30', label: t('analytics.range30') },
    { value: '90', label: t('analytics.range90') },
    { value: 'all', label: t('analytics.rangeAll') },
  ];

  const freshnessData: ChartDatum[] = data
    ? [
        {
          label: t('status.fresh'),
          value: data.by_status.fresh,
          color: statusColors.fresh.fg,
        },
        {
          label: t('status.nearlySpoiled'),
          value: data.by_status.nearly_spoiled,
          color: statusColors.nearly_spoiled.fg,
        },
        {
          label: t('status.overripe'),
          value: data.by_status.overripe,
          color: statusColors.overripe.fg,
        },
        {
          label: t('status.spoiled'),
          value: data.by_status.spoiled,
          color: statusColors.spoiled.fg,
        },
      ]
    : [];

  const categoryData: ChartDatum[] = data
    ? Object.entries(data.by_category)
        .map(([category, value]) => ({ label: t(`category.${category}`), value }))
        .sort((a, b) => b.value - a.value)
    : [];

  const rescueData: ChartDatum[] = data
    ? [
        {
          label: t('analytics.itemsRescued'),
          value: data.items_rescued,
          color: statusColors.fresh.fg,
        },
        {
          label: t('analytics.itemsDiscarded'),
          value: data.items_discarded,
          color: statusColors.spoiled.fg,
        },
      ]
    : [];

  return (
    <Screen showBack title={t('analytics.title')} tabBarPadding={false}>
      <Gutter>
        <SegmentedControl
          options={options}
          value={String(range)}
          onChange={(value) => setRange(value === 'all' ? 'all' : (Number(value) as AnalyticsRange))}
        />
      </Gutter>

      {isLoading ? (
        <LoadingState message={t('common.loading')} />
      ) : !data || data.total_scans === 0 ? (
        <EmptyState
          icon="chart"
          title={t('analytics.emptyTitle')}
          body={t('analytics.emptyBody')}
        />
      ) : (
        <>
          {/* --- Headline numbers ------------------------------------- */}
          <Section style={styles.section}>
            <StatRow>
              <MetricCard value={data.total_scans} label={t('analytics.itemsScanned')} />
              <MetricCard
                value={data.items_rescued}
                label={t('analytics.itemsRescued')}
                tone={statusColors.fresh.fg}
              />
            </StatRow>
            <View style={styles.spacer} />
            <StatRow>
              <MetricCard
                value={data.items_consumed}
                label={t('analytics.itemsConsumed')}
              />
              <MetricCard
                value={data.items_discarded}
                label={t('analytics.itemsDiscarded')}
                tone={statusColors.spoiled.fg}
              />
            </StatRow>
          </Section>

          {/* --- Rescue rate ------------------------------------------ */}
          <Section title={t('analytics.wastePrevention')}>
            <StatRow>
              <MetricCard
                // A dash, not 0%, when nothing has been resolved: 0% would
                // imply everything was thrown away.
                value={
                  data.rescue_rate === null
                    ? '—'
                    : `${Math.round(data.rescue_rate * 100)}%`
                }
                label={t('analytics.rescueRate')}
                tone={colors.primary}
              />
              <MetricCard
                value={data.recipes_generated}
                label={t('analytics.recipesGenerated')}
              />
            </StatRow>
          </Section>

          {/* --- Charts ----------------------------------------------- */}
          <Section>
            <ChartCard title={t('analytics.freshnessDistribution')}>
              <DonutChart
                data={freshnessData}
                centreValue={String(data.total_scans)}
                centreLabel={t('analytics.itemsScanned')}
                emptyLabel={t('analytics.emptyBody')}
              />
            </ChartCard>

            <ChartCard title={t('analytics.categoryDistribution')}>
              <BarChart data={categoryData} emptyLabel={t('analytics.emptyBody')} />
            </ChartCard>

            <ChartCard title={t('analytics.weeklyScans')}>
              <ColumnChart
                points={data.scans_per_day.map((point) => ({
                  label: point.date.slice(5),
                  value: point.count,
                }))}
                emptyLabel={t('analytics.emptyBody')}
              />
            </ChartCard>

            <ChartCard title={t('analytics.rescueTrend')}>
              <BarChart data={rescueData} emptyLabel={t('analytics.emptyBody')} />
            </ChartCard>
          </Section>

          {/* --- Methodology ------------------------------------------ */}
          <Section>
            <InfoCard
              title={t('analytics.methodologyTitle')}
              body={t('analytics.methodologyBody')}
              icon="info"
              tone="sunken"
            />
          </Section>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
  },
  spacer: {
    height: spacing.md,
  },
});
