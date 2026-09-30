import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Pill } from '../src/components/Badge';
import { PrimaryButton, SecondaryButton } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Icon } from '../src/components/Icon';
import { Gutter, Screen } from '../src/components/Screen';
import { EmptyState, ErrorState, SafetyNotice } from '../src/components/States';
import { Body, Caption, Label, Title } from '../src/components/Text';
import { useToast } from '../src/components/Toast';
import { STATUS_META } from '../src/constants/status';
import { useDetectFoods } from '../src/hooks/useDetection';
import { useAddInventoryItem } from '../src/hooks/useInventory';
import { useTranslation } from '../src/i18n';
import { ApiError } from '../src/services/api/client';
import type { DetectedItem } from '../src/services/api/endpoints';
import { persistImage } from '../src/services/image';
import { useAppStore } from '../src/store/app';
import { colors, palette, radius, spacing, statusColors } from '../src/theme';

/**
 * Multi-item scan.
 *
 * The backend finds several foods in one photo and scores each on its own.
 * This screen's job is to let the user *correct* that before anything reaches
 * their inventory: boxes are drawn over the photo so a wrong one is visible,
 * and every item is a checkbox rather than an automatic save. Writing seven
 * guessed rows into someone's kitchen and asking them to delete the wrong ones
 * is the wrong way round.
 *
 * Items the detector found but has no reference data for arrive unscored. They
 * are listed and shown, but cannot be selected -- there is nothing to save.
 */
export default function DetectionScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();

  const pendingScan = useAppStore((state) => state.pendingScan);
  const detect = useDetectFoods();
  const addItem = useAddInventoryItem();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const imageUri = pendingScan?.imageUri;

  useEffect(() => {
    if (!imageUri) return;
    detect.mutate(imageUri, {
      onSuccess: (data) => {
        // Pre-select everything scoreable: the common case is "yes, all of
        // these", and unticking two is less work than ticking five.
        setSelected(
          new Set(
            data.items
              .map((item, index) => (item.known_food ? index : -1))
              .filter((index) => index >= 0),
          ),
        );
      },
    });
    return () => detect.cancel();
    // Runs once per captured image; `detect` is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUri]);

  if (!imageUri) {
    return (
      <Screen showBack title={t('detection.title')} tabBarPadding={false}>
        <EmptyState
          icon="camera"
          title={t('detection.noImageTitle')}
          body={t('detection.noImageBody')}
          actionLabel={t('scanner.title')}
          onAction={() => router.replace('/scan')}
        />
      </Screen>
    );
  }

  if (detect.isPending) {
    return (
      <Screen showBack title={t('detection.title')} tabBarPadding={false}>
        <Gutter style={styles.centred}>
          <ActivityIndicator color={colors.primary} />
          <Body align="center" style={styles.pendingBody}>
            {t('detection.scanning')}
          </Body>
        </Gutter>
      </Screen>
    );
  }

  if (detect.isError) {
    const error = detect.error;
    const isApi = error instanceof ApiError;
    return (
      <Screen showBack title={t('detection.title')} tabBarPadding={false}>
        <ErrorState
          title={t(isApi ? error.titleKey : 'errors.genericTitle')}
          body={t(isApi ? error.bodyKey : 'errors.genericBody')}
          retryLabel={t('common.retry')}
          onRetry={() => detect.mutate(imageUri)}
          secondaryLabel={t('detection.scanSingle')}
          onSecondary={() => router.replace('/analysis')}
        />
      </Screen>
    );
  }

  const result = detect.data;
  if (!result) return null;

  const scoreable = result.items.filter((item) => item.known_food).length;

  const toggle = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const onSave = async () => {
    const chosen = [...selected]
      .map((index) => result.items[index])
      .filter((item): item is DetectedItem => Boolean(item?.known_food && item.status));

    if (chosen.length === 0) return;

    setSaving(true);
    try {
      // One stored copy of the photo, shared by every item from this scan:
      // they genuinely came from the same picture, and writing seven copies
      // of the same JPEG would waste the device's storage.
      const storedUri = await persistImage(imageUri, `${Date.now()}`);

      for (const item of chosen) {
        await addItem.mutateAsync({
          food_name: item.food_name as string,
          category: item.category ?? 'other',
          status: item.status as NonNullable<DetectedItem['status']>,
          score: item.score ?? 0,
          quantity: 1,
          unit: 'item',
          image_uri: storedUri,
          storage_type: 'refrigerated',
          purchase_date: null,
          best_before_date: null,
          estimated_remaining_days: item.estimated_window?.max_days ?? 0,
          assessed_at: new Date().toISOString(),
          resolved_at: null,
          resolution: null,
          source: 'scan',
          notes: null,
        });
      }

      setSaved(true);
      toast.show(t('detection.addedCount', { count: chosen.length }));
      router.replace('/inventory');
    } catch {
      toast.show(t('errors.genericBody'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen showBack title={t('detection.title')} tabBarPadding={false}>
      <Gutter style={styles.container}>
        {/* --- Photo with boxes ------------------------------------- */}
        <View style={styles.preview}>
          <Image source={{ uri: imageUri }} style={styles.image} contentFit="cover" />
          {result.items.map((item, index) => (
            <BoxOverlay
              key={`${item.raw_label}-${index}`}
              item={item}
              index={index}
              selected={selected.has(index)}
            />
          ))}
        </View>

        {result.count === 0 ? (
          <EmptyState
            icon="search"
            title={t('detection.noneTitle')}
            body={result.note ?? t('detection.noneBody')}
            actionLabel={t('detection.scanSingle')}
            onAction={() => router.replace('/analysis')}
          />
        ) : (
          <>
            <View style={styles.headingRow}>
              <Title heading>{t('detection.foundCount', { count: result.count })}</Title>
              <Caption>{t('detection.tapToToggle')}</Caption>
            </View>

            {result.items.map((item, index) => (
              <ItemRow
                key={`row-${item.raw_label}-${index}`}
                item={item}
                index={index}
                selected={selected.has(index)}
                onToggle={() => toggle(index)}
              />
            ))}

            {result.note ? (
              <Card tone="sunken">
                <Body>{result.note}</Body>
              </Card>
            ) : null}

            <PrimaryButton
              label={
                saved
                  ? t('detection.added')
                  : t('detection.addSelected', { count: selected.size })
              }
              icon={saved ? 'check' : 'plus'}
              disabled={saved || saving || selected.size === 0}
              loading={saving}
              onPress={onSave}
            />
            <SecondaryButton
              label={t('detection.scanSingle')}
              onPress={() => router.replace('/analysis')}
            />
            {scoreable === 0 ? (
              <Caption align="center">{t('detection.nothingScoreable')}</Caption>
            ) : null}
          </>
        )}

        <SafetyNotice text={result.safety_notice} compact />
      </Gutter>
    </Screen>
  );
}

/**
 * A box drawn over the photo.
 *
 * Positioned in percentages straight from the normalised coordinates, so it
 * lines up at any preview size without the screen needing to know what
 * resolution the backend analysed.
 */
function BoxOverlay({
  item,
  index,
  selected,
}: {
  item: DetectedItem;
  index: number;
  selected: boolean;
}) {
  const tone = item.status ? statusColors[item.status] : statusColors.unknown;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.box,
        {
          left: `${item.box.x1 * 100}%`,
          top: `${item.box.y1 * 100}%`,
          width: `${(item.box.x2 - item.box.x1) * 100}%`,
          height: `${(item.box.y2 - item.box.y1) * 100}%`,
          borderColor: tone.border,
          // Unselected items stay visible but recede, so the photo still
          // reads as a photo rather than a grid of equal boxes.
          opacity: selected ? 1 : 0.45,
        },
      ]}
    >
      <View style={[styles.boxTag, { backgroundColor: tone.border }]}>
        <Caption style={styles.boxTagText}>{index + 1}</Caption>
      </View>
    </View>
  );
}

function ItemRow({
  item,
  index,
  selected,
  onToggle,
}: {
  item: DetectedItem;
  index: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const tone = item.status ? statusColors[item.status] : statusColors.unknown;
  const label = item.food_name ?? item.raw_label;

  return (
    <Pressable
      onPress={item.known_food ? onToggle : undefined}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: !item.known_food }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        { borderColor: selected ? colors.primary : colors.border },
        pressed && item.known_food ? styles.rowPressed : null,
      ]}
    >
      <View style={[styles.index, { backgroundColor: tone.border }]}>
        <Caption style={styles.boxTagText}>{index + 1}</Caption>
      </View>

      <View style={styles.rowBody}>
        <Label>{label}</Label>
        {item.known_food && item.status ? (
          <Caption>
            {/* STATUS_META, not `status.${item.status}`: the API returns
                snake_case ("nearly_spoiled") while the locale keys are
                camelCase ("nearlySpoiled"), so interpolating the status
                rendered the raw key on screen for every status except
                "fresh", which happens to match in both. */}
            {t(STATUS_META[item.status].labelKey)} · {item.score}/100
          </Caption>
        ) : (
          // Detected but unscored. Saying so beats a blank line, and beats
          // inventing a score for a food with no reference data.
          <Caption>{t('detection.noReferenceData')}</Caption>
        )}
      </View>

      {item.known_food ? (
        <View style={[styles.check, selected ? styles.checkOn : null]}>
          {selected ? <Icon name="check" size={16} color={palette.white} /> : null}
        </View>
      ) : (
        <Pill label={t('detection.notSaved')} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  pendingBody: {
    maxWidth: 260,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: radius.sm,
  },
  boxTag: {
    position: 'absolute',
    top: -2,
    left: -2,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderRadius: radius.sm,
  },
  boxTagText: {
    color: palette.white,
    fontWeight: '700',
  },
  headingRow: {
    gap: spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    opacity: 0.7,
  },
  index: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
