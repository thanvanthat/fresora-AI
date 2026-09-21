import type { FoodStatus } from '../types';

/**
 * Semantics of a food status -- single source of truth.
 *
 * Deliberately free of any import from the theme or from `react-native`. The
 * *visual* treatment of a status lives in `theme/colors.ts` as `statusColors`,
 * and components look it up there. Keeping the two apart means this module is
 * pure data: the rules below can be unit-tested without a renderer, and status
 * logic is never re-derived inline in a component (rule 52).
 */
interface StatusMeta {
  /** i18n key for the human label. */
  labelKey: string;
  /** Icon name, resolved by the Icon component. */
  icon: 'leaf' | 'clock' | 'alert-triangle' | 'x-circle';
  /** Lower = more urgent. Drives consume-first ordering. */
  priority: number;
  /** Whether this item may be offered as a recipe ingredient (rule 50). */
  usableInRecipes: boolean;
  /** Score band this status occupies, inclusive. Mirrors backend thresholds. */
  scoreRange: [number, number];
}

export const STATUS_META: Record<FoodStatus, StatusMeta> = {
  fresh: {
    labelKey: 'status.fresh',
    icon: 'leaf',
    priority: 3,
    usableInRecipes: true,
    scoreRange: [80, 100],
  },
  nearly_spoiled: {
    labelKey: 'status.nearlySpoiled',
    icon: 'clock',
    priority: 1,
    usableInRecipes: true,
    scoreRange: [45, 79],
  },
  overripe: {
    labelKey: 'status.overripe',
    icon: 'alert-triangle',
    priority: 2,
    usableInRecipes: true,
    scoreRange: [25, 44],
  },
  spoiled: {
    labelKey: 'status.spoiled',
    icon: 'x-circle',
    priority: 4,
    usableInRecipes: false,
    scoreRange: [0, 24],
  },
};

/** Statuses that belong in the "Needs attention" bucket on Home and Inventory. */
export const ATTENTION_STATUSES: FoodStatus[] = ['nearly_spoiled', 'overripe'];

export const isUsableInRecipes = (status: FoodStatus): boolean =>
  STATUS_META[status].usableInRecipes;

export const needsAttention = (status: FoodStatus): boolean =>
  ATTENTION_STATUSES.includes(status);

/**
 * Maps a 0-100 score to a status.
 *
 * The backend already returns a status, so this is only for locally-entered
 * items that were never scanned. `allowOverripe` is false for foods that do not
 * ripen, matching the backend rule that bread is never "overripe".
 */
export function statusForScore(score: number, allowOverripe = true): FoodStatus {
  if (score >= STATUS_META.fresh.scoreRange[0]) return 'fresh';
  if (score >= STATUS_META.nearly_spoiled.scoreRange[0]) return 'nearly_spoiled';
  if (score >= STATUS_META.overripe.scoreRange[0]) {
    return allowOverripe ? 'overripe' : 'nearly_spoiled';
  }
  return 'spoiled';
}

/** Sort comparator for consume-first: urgency, then fewest days remaining. */
export const byConsumePriority = <
  T extends { status: FoodStatus; estimated_remaining_days: number | null },
>(
  a: T,
  b: T,
): number => {
  const pa = STATUS_META[a.status].priority;
  const pb = STATUS_META[b.status].priority;
  if (pa !== pb) return pa - pb;

  const da = a.estimated_remaining_days ?? Number.POSITIVE_INFINITY;
  const db = b.estimated_remaining_days ?? Number.POSITIVE_INFINITY;
  return da - db;
};
