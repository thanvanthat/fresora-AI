import { useQuery } from '@tanstack/react-query';

import { getStore } from '../services/storage';
import {
  buildShoppingSuggestions,
  computeAnalytics,
  type AnalyticsRange,
} from '../utils/inventory';

/**
 * Analytics and shopping suggestions.
 *
 * Computed on the device from the same rows the rest of the app reads -- there
 * is no separate analytics pipeline to drift out of step with reality, and the
 * numbers are reproducible from what the user can see in their inventory.
 */
export function useAnalytics(range: AnalyticsRange = 30) {
  return useQuery({
    queryKey: ['analytics', range],
    queryFn: async () => {
      const store = getStore();
      const [items, scans, recipes] = await Promise.all([
        store.listInventory(),
        store.listScans(),
        store.listRecipes(),
      ]);
      return computeAnalytics(items, scans, recipes.length, range);
    },
  });
}

export function useShoppingSuggestions() {
  return useQuery({
    queryKey: ['shopping'],
    queryFn: async () => {
      const store = getStore();
      const [items, list] = await Promise.all([
        store.listInventory(),
        store.getShoppingList(),
      ]);
      return { ...buildShoppingSuggestions(items), list };
    },
  });
}
