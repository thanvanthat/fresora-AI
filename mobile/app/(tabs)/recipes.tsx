import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton, SecondaryButton } from '../../src/components/Button';
import { Card, Section } from '../../src/components/Card';
import { SegmentedControl, type SegmentOption } from '../../src/components/Controls';
import { InfoCard } from '../../src/components/FoodCard';
import { Gutter, Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, SafetyNotice } from '../../src/components/States';
import { Body, Caption, Label, Subtitle } from '../../src/components/Text';
import { useToast } from '../../src/components/Toast';
import { RecipeDetail } from '../../src/features/recipes/RecipeDetail';
import { useInventory, useResolveMany } from '../../src/hooks/useInventory';
import { useGenerateRecipe, useSavedRecipes, useSaveRecipe } from '../../src/hooks/useRecipes';
import { useTranslation } from '../../src/i18n';
import { ApiError } from '../../src/services/api/client';
import type { RecipeResponseWire } from '../../src/services/api/endpoints';
import { spacing } from '../../src/theme';

/**
 * Recipes.
 *
 * Two jobs: generate something from what is about to be lost, and keep what
 * worked. The generated recipe is held in local state rather than persisted
 * automatically -- saving is the user's choice, and auto-saving every
 * generation would fill the Saved tab with things nobody cooked.
 */

type Tab = 'rescue' | 'saved';

export default function RecipesScreen() {
  const { t, tPlural } = useTranslation();
  const router = useRouter();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('rescue');
  const [generated, setGenerated] = useState<RecipeResponseWire | null>(null);

  const { candidates, attention, isLoading } = useInventory();
  const { data: saved = [] } = useSavedRecipes();
  const generate = useGenerateRecipe();
  const saveRecipe = useSaveRecipe();
  const resolveMany = useResolveMany();

  const options: SegmentOption<Tab>[] = [
    { value: 'rescue', label: t('recipes.tabZeroWaste') },
    { value: 'saved', label: t('recipes.tabSaved'), count: saved.length },
  ];

  const onGenerate = () => {
    generate.mutate(
      { items: candidates },
      { onSuccess: (recipe) => setGenerated(recipe) },
    );
  };

  const onSave = (recipe: RecipeResponseWire) => {
    saveRecipe.mutate(
      {
        title: recipe.title,
        description: recipe.description,
        prep_minutes: recipe.prep_minutes,
        cook_minutes: recipe.cook_minutes,
        servings: recipe.servings,
        ingredients: recipe.ingredients.map((ingredient) => ({
          ingredient_name: ingredient.ingredient_name,
          quantity: ingredient.quantity,
          is_rescued: ingredient.is_rescued,
          inventory_item_id: ingredient.inventory_item_id,
        })),
        instructions: recipe.instructions,
        rescued_item_ids: recipe.rescued_item_ids,
        tips: recipe.tips,
        saved: true,
        source: recipe.source,
      },
      { onSuccess: () => toast.show(t('recipes.savedRecipe')) },
    );
  };

  /** Marks every rescued ingredient consumed -- the "I cooked this" action. */
  const onCooked = (recipe: RecipeResponseWire) => {
    if (recipe.rescued_item_ids.length === 0) return;

    resolveMany.mutate(
      { ids: recipe.rescued_item_ids, resolution: 'consumed' },
      {
        onSuccess: () => {
          toast.show(
            t('recipes.cookedToast', { count: recipe.rescued_item_ids.length }),
          );
          setGenerated(null);
        },
      },
    );
  };

  return (
    <Screen title={t('recipes.title')} eyebrow={t('recipes.rescueTitle')}>
      <Gutter>
        <SegmentedControl options={options} value={tab} onChange={setTab} />
      </Gutter>

      {tab === 'rescue' ? (
        <View style={styles.section}>
          {generated ? (
            <RecipeDetail
              recipe={generated}
              onSave={() => onSave(generated)}
              onCooked={() => onCooked(generated)}
              onDiscard={() => setGenerated(null)}
              busy={saveRecipe.isPending || resolveMany.isPending}
            />
          ) : generate.isError ? (
            <ErrorState
              title={t(
                generate.error instanceof ApiError
                  ? generate.error.titleKey
                  : 'errors.genericTitle',
              )}
              body={t(
                generate.error instanceof ApiError
                  ? generate.error.bodyKey
                  : 'errors.recipeFailed',
              )}
              retryLabel={t('common.retry')}
              onRetry={onGenerate}
            />
          ) : (
            <Gutter style={styles.rescue}>
              <Card tone="sage">
                <Subtitle heading>{t('recipes.rescueTitle')}</Subtitle>
                <Body style={styles.rescueBody}>
                  {attention.length > 0
                    ? t('recipes.needAttention', { count: attention.length })
                    : t('recipes.emptyBody')}
                </Body>

                {candidates.length > 0 ? (
                  <View style={styles.ingredientList}>
                    {candidates.slice(0, 6).map((item) => (
                      <View key={item.id} style={styles.ingredientRow}>
                        <Label style={styles.ingredientName}>{item.food_name}</Label>
                        <Caption>
                          {item.displayRemaining === null
                            ? t('status.unknown')
                            : tPlural(
                                'common.aboutDay',
                                'common.aboutDays',
                                item.displayRemaining,
                              )}
                        </Caption>
                      </View>
                    ))}
                  </View>
                ) : null}

                <PrimaryButton
                  label={t('recipes.generate')}
                  icon="sparkle"
                  loading={generate.isPending}
                  disabled={candidates.length === 0 || isLoading}
                  onPress={onGenerate}
                  style={styles.generateButton}
                />
                {generate.isPending ? (
                  <Caption align="center" style={styles.generating}>
                    {t('recipes.generating')}
                  </Caption>
                ) : null}
              </Card>

              {candidates.length === 0 ? (
                <EmptyState
                  icon="chef"
                  title={t('recipes.emptyTitle')}
                  body={t('recipes.emptyBody')}
                  actionLabel={t('home.scanFood')}
                  onAction={() => router.push('/scan')}
                />
              ) : null}

              <SafetyNotice text={t('safety.recipeCaution')} compact />
            </Gutter>
          )}
        </View>
      ) : (
        <View style={styles.section}>
          {saved.length === 0 ? (
            <EmptyState icon="recipes" title={t('recipes.emptySaved')} />
          ) : (
            <Gutter>
              {saved.map((recipe) => (
                <Card
                  key={recipe.id}
                  style={styles.savedCard}
                  onPress={() => router.push(`/recipe/${recipe.id}`)}
                  accessibilityLabel={recipe.title}
                >
                  <Label style={styles.savedTitle}>{recipe.title}</Label>
                  <Caption numberOfLines={2}>{recipe.description}</Caption>
                  <View style={styles.savedMeta}>
                    <Caption>
                      {t('recipes.prep')} {t('recipes.minutes', { count: recipe.prep_minutes })}
                    </Caption>
                    <Caption>
                      {t('recipes.cook')} {t('recipes.minutes', { count: recipe.cook_minutes })}
                    </Caption>
                    {recipe.rescued_item_ids.length > 0 ? (
                      <Caption>
                        {tPlural(
                          'recipes.rescuedOne',
                          'recipes.rescued',
                          recipe.rescued_item_ids.length,
                        )}
                      </Caption>
                    ) : null}
                  </View>
                </Card>
              ))}
            </Gutter>
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
  },
  rescue: {
    gap: spacing.lg,
  },
  rescueBody: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  ingredientList: {
    marginTop: spacing.base,
    gap: spacing.sm,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ingredientName: {
    flex: 1,
  },
  generateButton: {
    marginTop: spacing.lg,
  },
  generating: {
    marginTop: spacing.sm,
  },
  savedCard: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  savedTitle: {
    fontSize: 17,
  },
  savedMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.base,
    marginTop: spacing.xs,
  },
});
