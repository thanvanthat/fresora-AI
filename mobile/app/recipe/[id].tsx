import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';

import { Screen } from '../../src/components/Screen';
import { EmptyState, LoadingState } from '../../src/components/States';
import { useToast } from '../../src/components/Toast';
import { RecipeDetail } from '../../src/features/recipes/RecipeDetail';
import { useResolveMany } from '../../src/hooks/useInventory';
import { useDeleteRecipe, useSavedRecipes } from '../../src/hooks/useRecipes';
import { useTranslation } from '../../src/i18n';
import type { RecipeResponseWire } from '../../src/services/api/endpoints';

/**
 * A saved recipe.
 *
 * Reuses the same RecipeDetail component as a freshly generated one, so a saved
 * recipe and a new one are presented identically. The stored `Recipe` is mapped
 * back onto the wire shape that component expects.
 */
export default function SavedRecipeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: recipes = [], isLoading } = useSavedRecipes();
  const resolveMany = useResolveMany();
  const deleteRecipe = useDeleteRecipe();

  const recipe = recipes.find((entry) => entry.id === id);

  /** Adapts the stored record to the shape RecipeDetail renders. */
  const wire = useMemo<RecipeResponseWire | null>(() => {
    if (!recipe) return null;
    return {
      title: recipe.title,
      description: recipe.description,
      prep_minutes: recipe.prep_minutes,
      cook_minutes: recipe.cook_minutes,
      servings: recipe.servings,
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
      rescued_item_ids: recipe.rescued_item_ids,
      tips: recipe.tips,
      source: recipe.source,
      excluded_item_ids: [],
      safety_notice: t('safety.fullNotice'),
      note: null,
    };
  }, [recipe, t]);

  if (isLoading) {
    return (
      <Screen showBack tabBarPadding={false}>
        <LoadingState message={t('common.loading')} />
      </Screen>
    );
  }

  if (!recipe || !wire) {
    return (
      <Screen showBack tabBarPadding={false}>
        <EmptyState
          icon="recipes"
          title={t('recipes.emptySaved')}
          actionLabel={t('recipes.tabZeroWaste')}
          onAction={() => router.replace('/recipes')}
        />
      </Screen>
    );
  }

  const onCooked = () => {
    if (recipe.rescued_item_ids.length === 0) return;

    resolveMany.mutate(
      { ids: recipe.rescued_item_ids, resolution: 'consumed' },
      {
        onSuccess: () => {
          toast.show(
            t('recipes.cookedToast', { count: recipe.rescued_item_ids.length }),
          );
          router.back();
        },
      },
    );
  };

  const onDelete = () => {
    deleteRecipe.mutate(recipe.id, {
      onSuccess: () => {
        toast.show(t('common.delete'));
        router.back();
      },
    });
  };

  return (
    <Screen showBack tabBarPadding={false}>
      <RecipeDetail
        recipe={wire}
        onCooked={onCooked}
        onDiscard={onDelete}
        busy={resolveMany.isPending || deleteRecipe.isPending}
      />
    </Screen>
  );
}
