import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { generateRecipe, toInventoryPayload } from '../services/api/endpoints';
import { getStore } from '../services/storage';
import { usePreferences } from '../store/app';
import type { Recipe } from '../types';
import type { InventoryView } from '../utils/inventory';
import { recipesKey } from './useInventory';

/** Saved recipes, plus zero-waste generation. */

export function useSavedRecipes() {
  return useQuery({
    queryKey: recipesKey,
    queryFn: () => getStore().listRecipes(),
  });
}

/**
 * Generates a zero-waste recipe from the caller's inventory.
 *
 * Spoiled items are excluded server-side, but they are filtered here too so a
 * spoiled item is never even transmitted. Defence in depth for the one rule
 * that must not fail (rule 50).
 */
export function useGenerateRecipe() {
  const preferences = usePreferences();

  return useMutation({
    mutationFn: async ({
      items,
      selectedIds = [],
      servings = 2,
    }: {
      items: InventoryView[];
      selectedIds?: string[];
      servings?: number;
    }) => {
      const usable = items.filter((item) => item.displayStatus !== 'spoiled');

      return generateRecipe({
        // The server scores urgency from `status`, so send the aged status.
        inventory: usable.map((item) =>
          toInventoryPayload({
            id: item.id,
            food_name: item.food_name,
            category: item.category,
            status: item.displayStatus,
            estimated_remaining_days: item.displayRemaining,
            quantity: item.quantity,
            unit: item.unit,
          }),
        ),
        servings,
        language: preferences.language,
        dietary_preferences: preferences.dietary_preferences,
        selected_item_ids: selectedIds,
      });
    },
  });
}

export function useSaveRecipe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (recipe: Omit<Recipe, 'id' | 'user_id' | 'created_at'>) =>
      getStore().addRecipe(recipe),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: recipesKey });
      client.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

export function useDeleteRecipe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getStore().deleteRecipe(id),
    onSuccess: () => client.invalidateQueries({ queryKey: recipesKey }),
  });
}
