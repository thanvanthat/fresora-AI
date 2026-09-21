import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { PrimaryButton, SecondaryButton } from '../../src/components/Button';
import { Section } from '../../src/components/Card';
import { SegmentedControl, type SegmentOption } from '../../src/components/Controls';
import { FoodCard, InfoCard } from '../../src/components/FoodCard';
import { Gutter, Screen } from '../../src/components/Screen';
import { EmptyState, SkeletonList } from '../../src/components/States';
import { Body, Eyebrow } from '../../src/components/Text';
import { useToast } from '../../src/components/Toast';
import {
  useInventory,
  useResolveInventoryItem,
  type InventoryView,
} from '../../src/hooks/useInventory';
import { useTranslation } from '../../src/i18n';
import { GUTTER, colors, spacing } from '../../src/theme';

/**
 * My Food.
 *
 * Tabs filter the list; the "Consume First" block sits above it because the
 * most urgent items are the whole reason to open this screen, and burying them
 * inside a scrolled list would defeat the point.
 */

type Filter = 'all' | 'fresh' | 'attention' | 'spoiled';

export default function InventoryScreen() {
  const { t, tPlural } = useTranslation();
  const router = useRouter();
  const toast = useToast();

  const [filter, setFilter] = useState<Filter>('all');
  const { view, counts, useToday, isLoading, refetch, isRefetching } = useInventory();
  const resolve = useResolveInventoryItem();

  const filtered = useMemo(() => {
    switch (filter) {
      case 'fresh':
        return view.filter((item) => item.displayStatus === 'fresh');
      case 'attention':
        return view.filter(
          (item) =>
            item.displayStatus === 'nearly_spoiled' || item.displayStatus === 'overripe',
        );
      case 'spoiled':
        return view.filter((item) => item.displayStatus === 'spoiled');
      default:
        return view;
    }
  }, [view, filter]);

  const options: SegmentOption<Filter>[] = [
    { value: 'all', label: t('inventory.tabAll'), count: counts.total },
    { value: 'fresh', label: t('inventory.tabFresh'), count: counts.fresh },
    { value: 'attention', label: t('inventory.tabAttention'), count: counts.attention },
    { value: 'spoiled', label: t('inventory.tabSpoiled'), count: counts.spoiled },
  ];

  const emptyBodyFor = (current: Filter): { title: string; body?: string } => {
    switch (current) {
      case 'fresh':
        return { title: t('inventory.emptyFresh') };
      case 'attention':
        return { title: t('inventory.emptyAttention') };
      case 'spoiled':
        return { title: t('inventory.emptySpoiled') };
      default:
        return { title: t('inventory.emptyTitle'), body: t('inventory.emptyBody') };
    }
  };

  const onConsumed = (item: InventoryView) => {
    resolve.mutate(
      { id: item.id, resolution: 'consumed' },
      {
        onSuccess: () =>
          toast.show(t('inventory.consumedToast', { food: item.food_name })),
      },
    );
  };

  const detailFor = (item: InventoryView): string => {
    if (item.displayRemaining === null) return t('status.unknown');
    return tPlural('inventory.dayRemaining', 'inventory.daysRemaining', item.displayRemaining);
  };

  return (
    <Screen
      eyebrow={t('inventory.subtitle')}
      title={t('inventory.title')}
      onRefresh={refetch}
      refreshing={isRefetching}
      scroll={false}
    >
      <Gutter>
        <SegmentedControl
          options={options}
          value={filter}
          onChange={setFilter}
          scrollable
          style={styles.filter}
        />
      </Gutter>

      {isLoading ? (
        <SkeletonList count={4} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          // FlatList rather than a mapped ScrollView: an inventory can grow to
          // hundreds of rows with images, and windowing keeps scroll smooth on
          // mid-range Android (rule 46).
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            // Consume First only appears on the unfiltered list, where it is
            // additional information rather than a contradiction of the filter.
            filter === 'all' && useToday.length > 0 ? (
              <View style={styles.consumeFirst}>
                <Eyebrow>{t('inventory.consumeFirst')}</Eyebrow>
                <Body style={styles.consumeFirstBody}>
                  {t('inventory.consumeFirstSubtitle')}
                </Body>
                <InfoCard
                  title={`🔥 ${t('inventory.useToday')}`}
                  body={useToday.map(
                    (item) =>
                      `${item.food_name} — ${
                        item.displayRemaining === null
                          ? t('status.unknown')
                          : tPlural(
                              'common.aboutDay',
                              'common.aboutDays',
                              item.displayRemaining,
                            )
                      }`,
                  )}
                  tone="warning"
                  icon="clock"
                  footer={
                    <PrimaryButton
                      label={t('inventory.generateMeal')}
                      icon="chef"
                      onPress={() => router.push('/recipes')}
                      style={styles.consumeAction}
                    />
                  }
                />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <FoodCard
              foodName={item.food_name}
              status={item.displayStatus}
              category={item.category}
              imageUri={item.image_uri}
              score={item.score}
              detail={detailFor(item)}
              meta={t('inventory.addedOn', {
                date: new Date(item.created_at).toLocaleDateString(),
              })}
              onPress={() => router.push(`/item/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              {...emptyBodyFor(filter)}
              icon={filter === 'attention' ? 'check' : 'leaf'}
              actionLabel={filter === 'all' ? t('home.scanFood') : undefined}
              onAction={filter === 'all' ? () => router.push('/scan') : undefined}
            />
          }
          ListFooterComponent={
            filtered.length > 0 ? (
              <Section style={styles.footer}>
                <SecondaryButton
                  label={t('home.addManually')}
                  icon="plus"
                  onPress={() => router.push('/add-food')}
                />
              </Section>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filter: {
    marginBottom: spacing.lg,
  },
  list: {
    paddingHorizontal: GUTTER,
    paddingBottom: 110,
  },
  consumeFirst: {
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },
  consumeFirstBody: {
    marginBottom: spacing.md,
  },
  consumeAction: {
    marginTop: spacing.base,
  },
  footer: {
    marginTop: spacing.lg,
  },
});
