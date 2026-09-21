import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getStore } from '../services/storage';
import type { InventoryItem } from '../types';
import {
  buildInventoryView,
  countByStatus,
  needsAttentionItems,
  recipeCandidates,
  useTodayItems,
  type InventoryView,
} from '../utils/inventory';

/**
 * Inventory reads and writes.
 *
 * The store is the source of truth; React Query owns the cache. Every mutation
 * invalidates the same key, so Home, Inventory, Recipes and Analytics all
 * refresh together rather than drifting apart.
 */

export const inventoryKey = ['inventory'] as const;
export const scansKey = ['scans'] as const;
export const recipesKey = ['recipes'] as const;
export const notificationsKey = ['notifications'] as const;

export function useInventory() {
  const query = useQuery({
    queryKey: inventoryKey,
    queryFn: () => getStore().listInventory(),
    // Items age with the clock, so the derived view is recomputed on focus.
    staleTime: 30_000,
  });

  const items = query.data ?? [];

  /**
   * The aged, sorted view plus every derived slice the screens need.
   *
   * Memoised on the raw rows: `buildInventoryView` reads the clock, and
   * recomputing it on every render would make list keys churn.
   */
  const derived = useMemo(() => {
    const view = buildInventoryView(items);
    return {
      view,
      counts: countByStatus(view),
      attention: needsAttentionItems(view),
      candidates: recipeCandidates(view),
      useToday: useTodayItems(view),
    };
  }, [items]);

  return { ...query, items, ...derived };
}

export function useInventoryItem(id: string | undefined) {
  return useQuery({
    queryKey: [...inventoryKey, id],
    queryFn: () => (id ? getStore().getInventoryItem(id) : null),
    enabled: Boolean(id),
  });
}

/** Invalidates everything that reads from inventory. */
function useInvalidateInventory() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: inventoryKey });
    client.invalidateQueries({ queryKey: ['analytics'] });
  };
}

export function useAddInventoryItem() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (item: Omit<InventoryItem, 'id' | 'created_at' | 'updated_at' | 'user_id'>) =>
      getStore().addInventoryItem(item),
    onSuccess: invalidate,
  });
}

export function useUpdateInventoryItem() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<InventoryItem> }) =>
      getStore().updateInventoryItem(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteInventoryItem() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (id: string) => getStore().deleteInventoryItem(id),
    onSuccess: invalidate,
  });
}

/** Marks an item consumed or discarded -- the rescue-metric input. */
export function useResolveInventoryItem() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({
      id,
      resolution,
    }: {
      id: string;
      resolution: 'consumed' | 'discarded';
    }) => getStore().resolveInventoryItem(id, resolution),
    onSuccess: invalidate,
  });
}

/** Resolves several items at once, for "I cooked this". */
export function useResolveMany() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async ({
      ids,
      resolution,
    }: {
      ids: string[];
      resolution: 'consumed' | 'discarded';
    }) => {
      const store = getStore();
      // Sequential on purpose: the local store rewrites the whole collection
      // per call, so parallel writes would race and lose updates.
      for (const id of ids) {
        await store.resolveInventoryItem(id, resolution);
      }
    },
    onSuccess: invalidate,
  });
}

export type { InventoryView };
