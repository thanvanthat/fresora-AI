import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getStore } from '../services/storage';
import { deleteStoredImage } from '../services/image';
import type { AnalysisResult, FoodScan } from '../types';
import { buildJourney, journeyTrend } from '../utils/inventory';
import { scansKey } from './useInventory';

/** Scan history and the freshness journey. */

export function useScans() {
  return useQuery({
    queryKey: scansKey,
    queryFn: () => getStore().listScans(),
  });
}

/** Groups history into Today / Yesterday / older date buckets. */
export function useGroupedScans(search = '') {
  const query = useScans();

  const groups = useMemo(() => {
    const scans = query.data ?? [];
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? scans.filter((scan) => scan.food_name.toLowerCase().includes(needle))
      : scans;

    const today = new Date();
    const todayKey = today.toDateString();
    const yesterdayKey = new Date(today.getTime() - 86_400_000).toDateString();

    const buckets = new Map<string, FoodScan[]>();
    for (const scan of filtered) {
      const key = new Date(scan.scanned_at).toDateString();
      const existing = buckets.get(key);
      if (existing) existing.push(scan);
      else buckets.set(key, [scan]);
    }

    return [...buckets.entries()].map(([key, items]) => ({
      key,
      /** 'today' | 'yesterday' | an absolute date the screen formats. */
      kind: key === todayKey ? 'today' : key === yesterdayKey ? 'yesterday' : 'date',
      date: new Date(items[0].scanned_at),
      items,
    }));
  }, [query.data, search]);

  return { ...query, groups };
}

export function useAddScan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      scan: Omit<FoodScan, 'id' | 'user_id'> & { analysis: AnalysisResult | null },
    ) => getStore().addScan(scan),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: scansKey });
      client.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

export function useDeleteScan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (scan: FoodScan) => {
      await getStore().deleteScan(scan.id);
      // Remove the image too, or the document directory grows without bound.
      await deleteStoredImage(scan.image_uri);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: scansKey });
      client.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

export function useClearScans() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => getStore().clearScans(),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: scansKey });
      client.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

/** Every scan of one inventory item, as a timeline with trend. */
export function useJourney(inventoryItemId: string | undefined) {
  const query = useQuery({
    queryKey: [...scansKey, 'journey', inventoryItemId],
    queryFn: () =>
      inventoryItemId ? getStore().listScansForItem(inventoryItemId) : [],
    enabled: Boolean(inventoryItemId),
  });

  const points = useMemo(() => buildJourney(query.data ?? []), [query.data]);

  return { ...query, points, trend: journeyTrend(points) };
}
