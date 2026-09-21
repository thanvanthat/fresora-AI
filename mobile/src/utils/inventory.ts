import { ATTENTION_STATUSES, STATUS_META, byConsumePriority } from '../constants/status';
import type {
  AnalyticsSummary,
  FoodScan,
  FoodStatus,
  InventoryItem,
} from '../types';

/**
 * Derived inventory logic.
 *
 * Kept as pure functions so the same rules drive Home, Inventory, Consume
 * First, Analytics and the notification scheduler -- and so they can be tested
 * without a store, a screen or a network.
 */

const MS_PER_DAY = 86_400_000;

/** Whole days elapsed since an ISO timestamp. Never negative. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const elapsed = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(elapsed / MS_PER_DAY));
}

/** Whole days until an ISO date. Negative once the date has passed. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * Days remaining for an item, aged forward from when it was last assessed.
 *
 * An assessment of "4 days" made three days ago means one day now. Without
 * this the inventory would quietly keep claiming 4 days forever.
 *
 * A user-entered best-before date wins when it is sooner: printed dates carry
 * information a photo cannot, so Fresora defers to them rather than
 * overriding them (rule 31).
 */
export function remainingDays(item: InventoryItem, now: Date = new Date()): number | null {
  const fromAssessment =
    item.estimated_remaining_days === null
      ? null
      : Math.max(0, item.estimated_remaining_days - daysSince(item.assessed_at, now));

  const fromLabel = item.best_before_date ? Math.max(0, daysUntil(item.best_before_date, now)) : null;

  if (fromAssessment === null) return fromLabel;
  if (fromLabel === null) return fromAssessment;
  return Math.min(fromAssessment, fromLabel);
}

/**
 * The status to display, aged forward.
 *
 * An item assessed Fresh with 4 days left is no longer Fresh once those days
 * have elapsed. This downgrades on elapsed time only -- it never upgrades,
 * because nothing improves in a fridge, and only a new scan can raise a status.
 */
export function effectiveStatus(item: InventoryItem, now: Date = new Date()): FoodStatus {
  if (item.status === 'spoiled') return 'spoiled';

  const remaining = remainingDays(item, now);
  if (remaining === null) return item.status;

  if (remaining <= 0) {
    // Out of estimated window. We do not claim "spoiled" from a lapsed timer
    // alone -- that needs a look at the food, so we ask for attention instead.
    return item.status === 'fresh' ? 'nearly_spoiled' : item.status;
  }
  if (remaining <= 1 && item.status === 'fresh') return 'nearly_spoiled';

  return item.status;
}

/** An item still in the kitchen: neither consumed nor discarded. */
export const isActive = (item: InventoryItem): boolean => item.resolved_at === null;

export interface InventoryView extends InventoryItem {
  /** Status after ageing. Use this for display, not `status`. */
  displayStatus: FoodStatus;
  /** Days left after ageing. */
  displayRemaining: number | null;
}

/** Decorates active items with their aged status, most urgent first. */
export function buildInventoryView(
  items: InventoryItem[],
  now: Date = new Date(),
): InventoryView[] {
  return items
    .filter(isActive)
    .map((item) => ({
      ...item,
      displayStatus: effectiveStatus(item, now),
      displayRemaining: remainingDays(item, now),
    }))
    .sort((a, b) =>
      byConsumePriority(
        { status: a.displayStatus, estimated_remaining_days: a.displayRemaining },
        { status: b.displayStatus, estimated_remaining_days: b.displayRemaining },
      ),
    );
}

export interface InventoryCounts {
  fresh: number;
  attention: number;
  spoiled: number;
  total: number;
}

export function countByStatus(view: InventoryView[]): InventoryCounts {
  const counts: InventoryCounts = { fresh: 0, attention: 0, spoiled: 0, total: view.length };

  for (const item of view) {
    if (item.displayStatus === 'fresh') counts.fresh += 1;
    else if (item.displayStatus === 'spoiled') counts.spoiled += 1;
    else counts.attention += 1;
  }
  return counts;
}

/** Items needing attention, most urgent first. Drives Home and Consume First. */
export function needsAttentionItems(view: InventoryView[]): InventoryView[] {
  return view.filter((item) => ATTENTION_STATUSES.includes(item.displayStatus));
}

/** Items a recipe may use: anything not assessed spoiled. */
export function recipeCandidates(view: InventoryView[]): InventoryView[] {
  return view.filter((item) => STATUS_META[item.displayStatus].usableInRecipes);
}

/** "Use today": one day or less remaining. */
export function useTodayItems(view: InventoryView[]): InventoryView[] {
  return view.filter(
    (item) =>
      item.displayRemaining !== null &&
      item.displayRemaining <= 1 &&
      item.displayStatus !== 'spoiled',
  );
}

// --- Freshness journey ---------------------------------------------------

export interface JourneyPoint {
  scan: FoodScan;
  /** 1-based day index relative to the first scan of this item. */
  day: number;
  /** Score change from the previous scan, null on the first. */
  delta: number | null;
}

/** Turns repeat scans of one item into a timeline. */
export function buildJourney(scans: FoodScan[]): JourneyPoint[] {
  if (scans.length === 0) return [];

  const ordered = [...scans].sort((a, b) => a.scanned_at.localeCompare(b.scanned_at));
  const first = new Date(ordered[0].scanned_at);

  return ordered.map((scan, index) => ({
    scan,
    day: daysSince(first.toISOString(), new Date(scan.scanned_at)) + 1,
    delta: index === 0 ? null : scan.score - ordered[index - 1].score,
  }));
}

export type JourneyTrend = 'improving' | 'declining' | 'stable';

export function journeyTrend(points: JourneyPoint[]): JourneyTrend | null {
  if (points.length < 2) return null;
  const delta = points[points.length - 1].delta ?? 0;
  if (delta <= -5) return 'declining';
  if (delta >= 5) return 'improving';
  return 'stable';
}

// --- Analytics -----------------------------------------------------------

export type AnalyticsRange = 7 | 30 | 90 | 'all';

function withinRange(iso: string, range: AnalyticsRange, now: Date): boolean {
  if (range === 'all') return true;
  return daysSince(iso, now) < range;
}

/** Local YYYY-MM-DD. Used as a chart bucket key. */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Computes the analytics summary.
 *
 * Definitions, which the Analytics screen shows verbatim so the numbers are
 * explainable:
 *
 * - **items_rescued**: inventory marked *consumed* while its status was
 *   `nearly_spoiled` or `overripe`. That is food that would plausibly have been
 *   lost, and the user's own action saved it.
 * - **rescue_rate**: consumed / (consumed + discarded). Null when nothing has
 *   been resolved yet, so the UI shows a dash rather than 0%.
 *
 * Money and carbon saved are deliberately absent: there is no price or
 * emissions data here, so any figure would be invented (rule 28).
 */
export function computeAnalytics(
  items: InventoryItem[],
  scans: FoodScan[],
  recipeCount: number,
  range: AnalyticsRange = 30,
  now: Date = new Date(),
): AnalyticsSummary {
  const rangedScans = scans.filter((scan) => withinRange(scan.scanned_at, range, now));
  const resolved = items.filter(
    (item) => item.resolved_at !== null && withinRange(item.resolved_at, range, now),
  );

  const byStatus: Record<FoodStatus, number> = {
    fresh: 0,
    nearly_spoiled: 0,
    overripe: 0,
    spoiled: 0,
  };
  const byCategory: Record<string, number> = {};

  for (const scan of rangedScans) {
    byStatus[scan.status] = (byStatus[scan.status] ?? 0) + 1;
    byCategory[scan.category] = (byCategory[scan.category] ?? 0) + 1;
  }

  const consumed = resolved.filter((item) => item.resolution === 'consumed');
  const discarded = resolved.filter((item) => item.resolution === 'discarded');
  const rescued = consumed.filter((item) => ATTENTION_STATUSES.includes(item.status));

  const settled = consumed.length + discarded.length;

  // Per-day scan buckets across the window, so gaps render as zero columns
  // rather than being silently dropped from the chart.
  const windowDays = range === 'all' ? 30 : range;
  const scansPerDay: Array<{ date: string; count: number }> = [];
  const counts = new Map<string, number>();
  for (const scan of rangedScans) {
    const key = dayKey(new Date(scan.scanned_at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * MS_PER_DAY);
    const key = dayKey(date);
    scansPerDay.push({ date: key, count: counts.get(key) ?? 0 });
  }

  // Weekly rescued-vs-discarded, oldest week first.
  const weeks = Math.max(1, Math.ceil(windowDays / 7));
  const rescuesPerWeek: Array<{ week_start: string; rescued: number; discarded: number }> = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const end = now.getTime() - index * 7 * MS_PER_DAY;
    const start = end - 7 * MS_PER_DAY;

    const inWeek = (iso: string | null) => {
      if (!iso) return false;
      const time = new Date(iso).getTime();
      return time > start && time <= end;
    };

    rescuesPerWeek.push({
      week_start: dayKey(new Date(start)),
      rescued: rescued.filter((item) => inWeek(item.resolved_at)).length,
      discarded: discarded.filter((item) => inWeek(item.resolved_at)).length,
    });
  }

  return {
    range_days: range,
    total_scans: rangedScans.length,
    by_status: byStatus,
    by_category: byCategory,
    items_consumed: consumed.length,
    items_discarded: discarded.length,
    items_rescued: rescued.length,
    recipes_generated: recipeCount,
    rescue_rate: settled === 0 ? null : consumed.length / settled,
    scans_per_day: scansPerDay,
    rescues_per_week: rescuesPerWeek,
  };
}

// --- Smart shopping ------------------------------------------------------

export interface ShoppingSuggestions {
  /** In the kitchen now -- do not buy again. */
  alreadyHave: string[];
  /** Active but nearly gone. */
  runningLow: string[];
  /** Consumed recently and no longer in stock. */
  suggested: string[];
}

/**
 * Suggests a shop from what was consumed and is no longer present.
 *
 * Only *consumed* items count, never discarded ones: suggesting a repurchase of
 * something the user threw away untouched would encourage exactly the waste the
 * app exists to prevent.
 */
export function buildShoppingSuggestions(
  items: InventoryItem[],
  now: Date = new Date(),
  lookbackDays = 30,
): ShoppingSuggestions {
  const active = items.filter(isActive);
  const activeNames = new Set(active.map((item) => item.food_name.toLowerCase()));

  const alreadyHave = [...new Set(active.map((item) => item.food_name))].sort();

  const runningLow = [
    ...new Set(
      active
        .filter((item) => item.quantity > 0 && item.quantity <= 1)
        .map((item) => item.food_name),
    ),
  ].sort();

  const consumedRecently = items.filter(
    (item) =>
      item.resolution === 'consumed' &&
      item.resolved_at !== null &&
      daysSince(item.resolved_at, now) <= lookbackDays,
  );

  const suggested = [
    ...new Set(
      consumedRecently
        .map((item) => item.food_name)
        .filter((name) => !activeNames.has(name.toLowerCase())),
    ),
  ].sort();

  return { alreadyHave, runningLow, suggested };
}
