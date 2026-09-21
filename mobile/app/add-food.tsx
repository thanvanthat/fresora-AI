import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, PrimaryButton } from '../src/components/Button';
import { BottomSheet, Field } from '../src/components/Controls';
import { FoodImage } from '../src/components/FoodCard';
import { Gutter, Screen } from '../src/components/Screen';
import { Body, Caption, Eyebrow } from '../src/components/Text';
import { useToast } from '../src/components/Toast';
import { useAddInventoryItem } from '../src/hooks/useInventory';
import { useTranslation } from '../src/i18n';
import { listKnownFoods, getShelfLife } from '../src/services/api/endpoints';
import { persistImage, pickFromGallery } from '../src/services/image';
import { usePreferences } from '../src/store/app';
import {
  FOOD_CATEGORIES,
  STORAGE_TYPES,
  type FoodCategory,
  type StorageType,
} from '../src/types';
import { spacing } from '../src/theme';

/**
 * Manual food entry.
 *
 * The path for when recognition fails, for packaged goods with a printed date,
 * and for stocking up without photographing every item.
 *
 * A manually added item gets no freshness score, because nothing was measured.
 * Its remaining days come from the curated shelf life for that food (or the
 * printed best-before date, whichever the user gives) -- never from a guess.
 */
export default function AddFoodScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const preferences = usePreferences();
  const addItem = useAddInventoryItem();

  const [foodName, setFoodName] = useState('');
  const [category, setCategory] = useState<FoodCategory>('other');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('item');
  const [storage, setStorage] = useState<StorageType>(preferences.default_storage);
  const [bestBefore, setBestBefore] = useState('');
  const [notes, setNotes] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);

  const [knownFoods, setKnownFoods] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The picker offers only foods the backend has data for, so a manual entry
  // still gets real storage advice and a real shelf-life figure.
  useEffect(() => {
    listKnownFoods()
      .then((response) => setKnownFoods(response.foods))
      .catch(() => setKnownFoods([]));
  }, []);

  const onPickImage = async () => {
    const result = await pickFromGallery();
    if (result.permissionDenied) {
      toast.show(t('errors.galleryPermissionBody'), 'error');
      return;
    }
    if (!result.cancelled) setImageUri(result.uri);
  };

  const onSave = async () => {
    const name = foodName.trim();
    if (!name) {
      setError(t('inventory.foodName'));
      return;
    }
    setError(null);

    // Ask the backend for the curated window rather than inventing one.
    let remainingDays: number | null = null;
    try {
      const shelfLife = await getShelfLife({
        food_name: name,
        status: 'fresh',
        score: 100,
        storage_type: storage,
      });
      remainingDays = shelfLife.estimated_window.max_days || null;
    } catch {
      // Offline or unknown food: leave it null. The inventory shows "not
      // assessed" rather than a made-up number.
      remainingDays = null;
    }

    const id = `${Date.now()}`;
    const storedUri = imageUri ? await persistImage(imageUri, id) : null;

    const parsedQuantity = Number.parseFloat(quantity);

    await addItem.mutateAsync({
      food_name: name,
      category,
      // Manually added food has not been assessed, so it starts as fresh with
      // no score: `score: null` is what makes the UI omit a freshness figure.
      status: 'fresh',
      score: null,
      quantity: Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1,
      unit: unit.trim() || 'item',
      image_uri: storedUri,
      storage_type: storage,
      purchase_date: new Date().toISOString(),
      best_before_date: bestBefore.trim() ? bestBefore.trim() : null,
      estimated_remaining_days: remainingDays,
      assessed_at: new Date().toISOString(),
      resolved_at: null,
      resolution: null,
      source: 'manual',
      notes: notes.trim() || null,
    });

    toast.show(t('analysis.addedToInventory'));
    router.back();
  };

  return (
    <Screen
      showBack
      title={t('inventory.addManualTitle')}
      tabBarPadding={false}
      keyboardAware
    >
      <Gutter style={styles.container}>
        {/* --- Photo ------------------------------------------------- */}
        <View style={styles.photoRow}>
          <FoodImage uri={imageUri} category={category} size={78} />
          <View style={styles.photoText}>
            <Chip
              label={imageUri ? t('scanner.retake') : t('inventory.addPhoto')}
              icon="gallery"
              onPress={onPickImage}
            />
            <Caption style={styles.photoHint}>{t('common.optional')}</Caption>
          </View>
        </View>

        {/* --- Name -------------------------------------------------- */}
        <Field
          label={t('inventory.foodName')}
          value={foodName}
          onChangeText={setFoodName}
          error={error ?? undefined}
          placeholder="Tomato"
          autoCapitalize="words"
        />

        {knownFoods.length > 0 ? (
          <Chip
            label={t('recipes.selectIngredients')}
            icon="search"
            onPress={() => setPickerOpen(true)}
          />
        ) : null}

        {/* --- Category ---------------------------------------------- */}
        <View style={styles.block}>
          <Eyebrow>{t('scanner.categoryHint')}</Eyebrow>
          <View style={styles.chips}>
            {FOOD_CATEGORIES.map((choice) => (
              <Chip
                key={choice}
                label={t(`category.${choice}`)}
                selected={category === choice}
                onPress={() => setCategory(choice)}
              />
            ))}
          </View>
        </View>

        {/* --- Quantity ---------------------------------------------- */}
        <View style={styles.row}>
          <Field
            label={t('inventory.quantity')}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            style={styles.rowField}
          />
          <Field
            label={t('inventory.unit')}
            value={unit}
            onChangeText={setUnit}
            placeholder="item"
            autoCapitalize="none"
            style={styles.rowField}
          />
        </View>

        {/* --- Storage ----------------------------------------------- */}
        <View style={styles.block}>
          <Eyebrow>{t('inventory.storageType')}</Eyebrow>
          <View style={styles.chips}>
            {STORAGE_TYPES.map((choice) => (
              <Chip
                key={choice}
                label={t(`storage.${choice}`)}
                selected={storage === choice}
                onPress={() => setStorage(choice)}
              />
            ))}
          </View>
        </View>

        {/* --- Printed date ------------------------------------------- */}
        <Field
          label={t('inventory.bestBefore')}
          value={bestBefore}
          onChangeText={setBestBefore}
          placeholder="2026-10-15"
          hint={t('common.optional')}
          autoCapitalize="none"
        />
        <Caption style={styles.dateHint}>
          A printed date always takes priority over Fresora&apos;s estimate.
        </Caption>

        <Field
          label={t('inventory.notes')}
          value={notes}
          onChangeText={setNotes}
          hint={t('common.optional')}
          multiline
        />

        <PrimaryButton
          label={t('inventory.saveItem')}
          size="lg"
          icon="check"
          loading={addItem.isPending}
          onPress={onSave}
          style={styles.save}
        />
      </Gutter>

      {/* --- Known-food picker --------------------------------------- */}
      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('inventory.foodName')}
      >
        <View style={styles.chips}>
          {knownFoods.map((name) => (
            <Chip
              key={name}
              label={name}
              onPress={() => {
                setFoodName(name);
                setPickerOpen(false);
              }}
            />
          ))}
        </View>
        <View style={styles.sheetFooter} />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  photoText: {
    flex: 1,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  photoHint: {
    marginLeft: spacing.xs,
  },
  block: {
    gap: spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowField: {
    flex: 1,
  },
  dateHint: {
    marginTop: -spacing.md,
    lineHeight: 17,
  },
  save: {
    marginTop: spacing.sm,
  },
  sheetFooter: {
    height: spacing.xxl,
  },
});
