import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FoodStatusBadge, Pill } from '../../src/components/Badge';
import { Button, PrimaryButton, SecondaryButton } from '../../src/components/Button';
import { Card, Divider, Section } from '../../src/components/Card';
import { ConfirmModal } from '../../src/components/Controls';
import { FoodImage, InfoCard } from '../../src/components/FoodCard';
import { Gutter, Screen } from '../../src/components/Screen';
import { FreshnessScore } from '../../src/components/Score';
import { Sparkline } from '../../src/components/Charts';
import { EmptyState, LoadingState, SafetyNotice } from '../../src/components/States';
import { Body, Caption, Display, Eyebrow, Label } from '../../src/components/Text';
import { useToast } from '../../src/components/Toast';
import {
  useDeleteInventoryItem,
  useInventoryItem,
  useResolveInventoryItem,
} from '../../src/hooks/useInventory';
import { useJourney } from '../../src/hooks/useScans';
import { useTranslation } from '../../src/i18n';
import { effectiveStatus, remainingDays } from '../../src/utils/inventory';
import { colors, spacing, statusColors } from '../../src/theme';

/**
 * Inventory item detail, including the freshness journey.
 *
 * The journey is the reason repeat scanning is worth doing: it turns a pile of
 * scans into a visible trend, so the user can see deterioration happening
 * rather than being told about it.
 */
export default function ItemDetailScreen() {
  const { t, tPlural } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: item, isLoading } = useInventoryItem(id);
  const { points, trend } = useJourney(id);
  const resolve = useResolveInventoryItem();
  const remove = useDeleteInventoryItem();

  const [confirmRemove, setConfirmRemove] = useState(false);

  if (isLoading) {
    return (
      <Screen showBack tabBarPadding={false}>
        <LoadingState message={t('common.loading')} />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen showBack tabBarPadding={false}>
        <EmptyState
          icon="box"
          title={t('errors.genericTitle')}
          actionLabel={t('inventory.title')}
          onAction={() => router.replace('/inventory')}
        />
      </Screen>
    );
  }

  const status = effectiveStatus(item);
  const remaining = remainingDays(item);
  const resolved = item.resolved_at !== null;

  const onResolve = (resolution: 'consumed' | 'discarded') => {
    resolve.mutate(
      { id: item.id, resolution },
      {
        onSuccess: () => {
          toast.show(
            t(
              resolution === 'consumed'
                ? 'inventory.consumedToast'
                : 'inventory.discardedToast',
              { food: item.food_name },
            ),
          );
          router.back();
        },
      },
    );
  };

  const onRemove = () => {
    setConfirmRemove(false);
    remove.mutate(item.id, {
      onSuccess: () => {
        toast.show(t('inventory.removedToast', { food: item.food_name }));
        router.back();
      },
    });
  };

  return (
    <Screen showBack tabBarPadding={false}>
      {/* --- Identity -------------------------------------------------- */}
      <Gutter style={styles.header}>
        <FoodImage uri={item.image_uri} category={item.category} size={96} />
        <View style={styles.headerText}>
          <Display>{item.food_name}</Display>
          <FoodStatusBadge status={status} />
          <Caption>
            {t('inventory.addedOn', {
              date: new Date(item.created_at).toLocaleDateString(),
            })}
          </Caption>
        </View>
      </Gutter>

      {/* --- Current state --------------------------------------------- */}
      <Section>
        <Card>
          <View style={styles.stateRow}>
            <View>
              <Caption>{t('analysis.windowTitle')}</Caption>
              <Label style={styles.stateValue}>
                {remaining === null
                  ? t('status.unknown')
                  : tPlural('inventory.dayRemaining', 'inventory.daysRemaining', remaining)}
              </Label>
            </View>
            {item.score !== null ? (
              <FreshnessScore score={item.score} status={status} showBadge={false} />
            ) : null}
          </View>

          <Divider style={styles.divider} />

          <View style={styles.pills}>
            <Pill label={t(`storage.${item.storage_type}`)} icon="fridge" tone="sage" />
            <Pill label={t(`category.${item.category}`)} />
            <Pill
              label={`${item.quantity} ${item.unit}`}
              icon="box"
            />
            {item.source === 'manual' ? <Pill label={t('home.addManually')} /> : null}
          </View>

          {item.best_before_date ? (
            <Caption style={styles.bestBefore}>
              {t('inventory.bestBefore')}: {item.best_before_date}
            </Caption>
          ) : null}

          {item.notes ? <Body style={styles.notes}>{item.notes}</Body> : null}
        </Card>
      </Section>

      {/* --- Freshness journey ----------------------------------------- */}
      <Section title={t('journey.title')}>
        {points.length === 0 ? (
          <InfoCard
            title={t('journey.emptyBody')}
            body={t('journey.rescanCta')}
            icon="camera"
            tone="sage"
          />
        ) : (
          <Card>
            <View style={styles.journeyHeader}>
              <Caption>{t('journey.scanCount', { count: points.length })}</Caption>
              {points.length >= 2 ? (
                <Sparkline
                  values={points.map((point) => point.scan.score)}
                  color={statusColors[status].fg}
                />
              ) : null}
            </View>

            {trend ? (
              <Body style={styles.trend}>
                {t(
                  trend === 'declining'
                    ? 'journey.trendDeclining'
                    : trend === 'improving'
                      ? 'journey.trendImproving'
                      : 'journey.trendStable',
                )}
              </Body>
            ) : null}

            <Divider style={styles.divider} />

            {points.map((point) => (
              <View key={point.scan.id} style={styles.journeyRow}>
                <View style={styles.journeyDay}>
                  <Caption style={styles.journeyDayText}>
                    {t('journey.dayLabel', { n: point.day })}
                  </Caption>
                </View>
                <FoodImage
                  uri={point.scan.image_uri}
                  category={point.scan.category}
                  size={42}
                />
                <View style={styles.journeyMeta}>
                  <FoodStatusBadge status={point.scan.status} size="sm" />
                  <Caption>
                    {new Date(point.scan.scanned_at).toLocaleDateString()}
                  </Caption>
                </View>
                <View style={styles.journeyScore}>
                  <Label>{point.scan.score}</Label>
                  {point.delta !== null ? (
                    <Caption
                      style={{
                        color: point.delta < 0 ? statusColors.spoiled.fg : statusColors.fresh.fg,
                      }}
                    >
                      {point.delta > 0 ? `+${point.delta}` : point.delta}
                    </Caption>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
        )}
      </Section>

      {/* --- Actions --------------------------------------------------- */}
      <Gutter style={styles.actions}>
        {resolved ? (
          <InfoCard
            title={
              item.resolution === 'consumed'
                ? t('inventory.markConsumed')
                : t('inventory.markDiscarded')
            }
            body={new Date(item.resolved_at as string).toLocaleDateString()}
            icon="check"
            tone="sage"
          />
        ) : (
          <>
            <PrimaryButton
              label={t('inventory.markConsumed')}
              icon="check"
              loading={resolve.isPending}
              onPress={() => onResolve('consumed')}
            />
            <SecondaryButton
              label={t('inventory.rescan')}
              icon="camera"
              onPress={() => router.push('/scan')}
            />
            <Button
              label={t('inventory.markDiscarded')}
              variant="ghost"
              icon="trash"
              onPress={() => onResolve('discarded')}
            />
          </>
        )}

        <Button
          label={t('common.remove')}
          variant="danger"
          icon="trash"
          onPress={() => setConfirmRemove(true)}
        />

        {status === 'spoiled' ? (
          <SafetyNotice text={t('safety.spoiledGuidance')} />
        ) : (
          <SafetyNotice text={t('safety.shortNotice')} compact />
        )}
      </Gutter>

      <ConfirmModal
        visible={confirmRemove}
        title={t('common.remove')}
        body={item.food_name}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onRemove}
        onCancel={() => setConfirmRemove(false)}
        destructive
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    gap: spacing.base,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  headerText: {
    flex: 1,
    gap: spacing.sm,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stateValue: {
    fontSize: 17,
    marginTop: 2,
  },
  divider: {
    marginVertical: spacing.base,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bestBefore: {
    marginTop: spacing.md,
  },
  notes: {
    marginTop: spacing.md,
    lineHeight: 21,
  },
  journeyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trend: {
    marginTop: spacing.sm,
    color: colors.textPrimary,
  },
  journeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  journeyDay: {
    width: 52,
  },
  journeyDayText: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  journeyMeta: {
    flex: 1,
    gap: 3,
  },
  journeyScore: {
    alignItems: 'flex-end',
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.base,
  },
});
