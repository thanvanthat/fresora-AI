import {
  buildInventoryView,
  buildJourney,
  buildShoppingSuggestions,
  computeAnalytics,
  countByStatus,
  daysSince,
  effectiveStatus,
  journeyTrend,
  needsAttentionItems,
  recipeCandidates,
  remainingDays,
  useTodayItems,
} from './inventory';
import type { FoodScan, FoodStatus, InventoryItem } from '../types';

/**
 * Inventory logic: ageing, prioritisation, analytics and shopping.
 *
 * `NOW` is fixed so nothing here depends on when the suite runs -- ageing tests
 * that use the real clock pass in the morning and fail at midnight.
 */

const NOW = new Date('2026-03-15T12:00:00.000Z');

/** Days before NOW, as an ISO string. */
const daysAgo = (days: number): string =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

const daysAhead = (days: number): string =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString();

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'i1',
    user_id: null,
    food_name: 'Tomato',
    category: 'vegetable',
    status: 'fresh',
    score: 92,
    quantity: 1,
    unit: 'item',
    image_uri: null,
    storage_type: 'counter',
    purchase_date: null,
    best_before_date: null,
    estimated_remaining_days: 4,
    assessed_at: daysAgo(0),
    resolved_at: null,
    resolution: null,
    source: 'scan',
    notes: null,
    created_at: daysAgo(0),
    updated_at: daysAgo(0),
    ...overrides,
  };
}

function scan(overrides: Partial<FoodScan> = {}): FoodScan {
  return {
    id: 's1',
    user_id: null,
    food_name: 'Tomato',
    category: 'vegetable',
    status: 'fresh',
    score: 92,
    confidence: 0.9,
    image_uri: null,
    analysis: null,
    inventory_item_id: 'i1',
    scanned_at: daysAgo(0),
    ...overrides,
  };
}

// --- Ageing ---------------------------------------------------------------

describe('remainingDays', () => {
  it('ages an assessment forward by elapsed time', () => {
    // Assessed 4 days, three days ago -> 1 day left.
    const aged = item({ estimated_remaining_days: 4, assessed_at: daysAgo(3) });
    expect(remainingDays(aged, NOW)).toBe(1);
  });

  it('never goes negative', () => {
    const stale = item({ estimated_remaining_days: 2, assessed_at: daysAgo(10) });
    expect(remainingDays(stale, NOW)).toBe(0);
  });

  it('returns null when nothing was estimated and no date was given', () => {
    expect(remainingDays(item({ estimated_remaining_days: null }), NOW)).toBeNull();
  });

  it('defers to a printed best-before date when it is sooner', () => {
    // The assessment says 4 days, but the packet says 1.
    const withDate = item({
      estimated_remaining_days: 4,
      best_before_date: daysAhead(1),
    });
    expect(remainingDays(withDate, NOW)).toBe(1);
  });

  it('keeps the assessment when the printed date is further out', () => {
    const withDate = item({
      estimated_remaining_days: 2,
      best_before_date: daysAhead(30),
    });
    expect(remainingDays(withDate, NOW)).toBe(2);
  });

  it('uses the printed date alone when there is no assessment', () => {
    const labelOnly = item({
      estimated_remaining_days: null,
      best_before_date: daysAhead(6),
    });
    expect(remainingDays(labelOnly, NOW)).toBe(6);
  });
});

describe('effectiveStatus', () => {
  it('keeps a fresh item fresh while time remains', () => {
    expect(effectiveStatus(item({ estimated_remaining_days: 5 }), NOW)).toBe('fresh');
  });

  it('downgrades fresh to needing attention on the last day', () => {
    const almost = item({ estimated_remaining_days: 4, assessed_at: daysAgo(3) });
    expect(effectiveStatus(almost, NOW)).toBe('nearly_spoiled');
  });

  it('downgrades to attention once the window has lapsed', () => {
    const lapsed = item({ estimated_remaining_days: 2, assessed_at: daysAgo(9) });
    expect(effectiveStatus(lapsed, NOW)).toBe('nearly_spoiled');
  });

  it('never claims spoiled from a lapsed timer alone', () => {
    // A lapsed estimate is not evidence of spoilage -- that needs a look at
    // the food, so the app asks for attention instead of deciding.
    const lapsed = item({ estimated_remaining_days: 1, assessed_at: daysAgo(30) });
    expect(effectiveStatus(lapsed, NOW)).not.toBe('spoiled');
  });

  it('keeps spoiled spoiled', () => {
    expect(effectiveStatus(item({ status: 'spoiled' }), NOW)).toBe('spoiled');
  });

  it('never upgrades a status', () => {
    // Nothing improves in a fridge; only a new scan can raise a status.
    const declining = item({ status: 'nearly_spoiled', estimated_remaining_days: 10 });
    expect(effectiveStatus(declining, NOW)).toBe('nearly_spoiled');
  });
});

// --- Views and slices -----------------------------------------------------

describe('buildInventoryView', () => {
  it('excludes resolved items', () => {
    const view = buildInventoryView(
      [item({ id: 'a' }), item({ id: 'b', resolved_at: daysAgo(1), resolution: 'consumed' })],
      NOW,
    );
    expect(view.map((entry) => entry.id)).toEqual(['a']);
  });

  it('sorts most urgent first', () => {
    const view = buildInventoryView(
      [
        item({ id: 'fresh', status: 'fresh', estimated_remaining_days: 9 }),
        item({ id: 'spoiled', status: 'spoiled', estimated_remaining_days: 0 }),
        item({ id: 'urgent', status: 'nearly_spoiled', estimated_remaining_days: 1 }),
        item({ id: 'overripe', status: 'overripe', estimated_remaining_days: 2 }),
      ],
      NOW,
    );
    // nearly_spoiled -> overripe -> fresh -> spoiled
    expect(view.map((entry) => entry.id)).toEqual(['urgent', 'overripe', 'fresh', 'spoiled']);
  });

  it('breaks ties by fewest days remaining', () => {
    const view = buildInventoryView(
      [
        item({ id: 'two', status: 'nearly_spoiled', estimated_remaining_days: 2 }),
        item({ id: 'one', status: 'nearly_spoiled', estimated_remaining_days: 1 }),
      ],
      NOW,
    );
    expect(view.map((entry) => entry.id)).toEqual(['one', 'two']);
  });
});

describe('derived slices', () => {
  const view = buildInventoryView(
    [
      item({ id: 'f1', status: 'fresh', estimated_remaining_days: 8 }),
      item({ id: 'f2', status: 'fresh', estimated_remaining_days: 9 }),
      item({ id: 'a1', status: 'nearly_spoiled', estimated_remaining_days: 1 }),
      item({ id: 'a2', status: 'overripe', estimated_remaining_days: 2 }),
      item({ id: 's1', status: 'spoiled', estimated_remaining_days: 0 }),
    ],
    NOW,
  );

  it('counts by status bucket', () => {
    expect(countByStatus(view)).toEqual({ fresh: 2, attention: 2, spoiled: 1, total: 5 });
  });

  it('flags only attention statuses', () => {
    expect(needsAttentionItems(view).map((entry) => entry.id)).toEqual(['a1', 'a2']);
  });

  it('excludes spoiled items from recipe candidates', () => {
    const ids = recipeCandidates(view).map((entry) => entry.id);
    expect(ids).not.toContain('s1');
    expect(ids).toHaveLength(4);
  });

  it('puts one-day items in use-today and leaves spoiled out', () => {
    const ids = useTodayItems(view).map((entry) => entry.id);
    expect(ids).toContain('a1');
    expect(ids).not.toContain('s1');
    expect(ids).not.toContain('f1');
  });
});

// --- Freshness journey ----------------------------------------------------

describe('buildJourney', () => {
  it('returns nothing for no scans', () => {
    expect(buildJourney([])).toEqual([]);
  });

  it('orders oldest first and numbers days from the first scan', () => {
    const points = buildJourney([
      scan({ id: 'c', score: 40, scanned_at: daysAgo(0) }),
      scan({ id: 'a', score: 92, scanned_at: daysAgo(4) }),
      scan({ id: 'b', score: 65, scanned_at: daysAgo(2) }),
    ]);
    expect(points.map((point) => point.scan.id)).toEqual(['a', 'b', 'c']);
    expect(points.map((point) => point.day)).toEqual([1, 3, 5]);
  });

  it('computes the score delta, with null on the first point', () => {
    const points = buildJourney([
      scan({ id: 'a', score: 90, scanned_at: daysAgo(2) }),
      scan({ id: 'b', score: 70, scanned_at: daysAgo(1) }),
    ]);
    expect(points[0].delta).toBeNull();
    expect(points[1].delta).toBe(-20);
  });
});

describe('journeyTrend', () => {
  const trendFor = (scores: number[]) =>
    journeyTrend(
      buildJourney(
        scores.map((score, index) =>
          scan({ id: `s${index}`, score, scanned_at: daysAgo(scores.length - index) }),
        ),
      ),
    );

  it('needs at least two scans', () => {
    expect(trendFor([90])).toBeNull();
  });

  it('reports a decline', () => {
    expect(trendFor([90, 60])).toBe('declining');
  });

  it('reports stability for small movement', () => {
    expect(trendFor([90, 88])).toBe('stable');
  });

  it('reports an improvement when a rescan reads higher', () => {
    expect(trendFor([60, 80])).toBe('improving');
  });
});

// --- Analytics ------------------------------------------------------------

describe('computeAnalytics', () => {
  const scans = [
    scan({ id: 's1', status: 'fresh', scanned_at: daysAgo(1) }),
    scan({ id: 's2', status: 'fresh', scanned_at: daysAgo(2) }),
    scan({ id: 's3', status: 'nearly_spoiled', scanned_at: daysAgo(3), category: 'fruit' }),
    scan({ id: 's4', status: 'spoiled', scanned_at: daysAgo(40), category: 'dairy' }),
  ];

  const items = [
    // Consumed while needing attention -> rescued.
    item({
      id: 'r1',
      status: 'nearly_spoiled',
      resolution: 'consumed',
      resolved_at: daysAgo(2),
    }),
    // Consumed while fresh -> counted as consumed, but not a rescue.
    item({ id: 'c1', status: 'fresh', resolution: 'consumed', resolved_at: daysAgo(3) }),
    // Discarded.
    item({ id: 'd1', status: 'spoiled', resolution: 'discarded', resolved_at: daysAgo(4) }),
  ];

  it('respects the date range', () => {
    const last7 = computeAnalytics(items, scans, 0, 7, NOW);
    // s4 is 40 days old, so it falls outside.
    expect(last7.total_scans).toBe(3);

    const all = computeAnalytics(items, scans, 0, 'all', NOW);
    expect(all.total_scans).toBe(4);
  });

  it('buckets scans by status', () => {
    const result = computeAnalytics(items, scans, 0, 7, NOW);
    expect(result.by_status.fresh).toBe(2);
    expect(result.by_status.nearly_spoiled).toBe(1);
    expect(result.by_status.spoiled).toBe(0);
  });

  it('buckets scans by category', () => {
    const result = computeAnalytics(items, scans, 0, 7, NOW);
    expect(result.by_category.vegetable).toBe(2);
    expect(result.by_category.fruit).toBe(1);
  });

  it('counts a rescue only when an at-risk item was consumed', () => {
    const result = computeAnalytics(items, scans, 0, 30, NOW);
    expect(result.items_consumed).toBe(2);
    expect(result.items_discarded).toBe(1);
    // Only r1 was at risk when consumed.
    expect(result.items_rescued).toBe(1);
  });

  it('computes rescue rate as consumed over settled', () => {
    const result = computeAnalytics(items, scans, 0, 30, NOW);
    expect(result.rescue_rate).toBeCloseTo(2 / 3, 5);
  });

  it('returns null rescue rate when nothing has been resolved', () => {
    // Null, not zero: 0% would imply everything was thrown away.
    const result = computeAnalytics([item()], scans, 0, 30, NOW);
    expect(result.rescue_rate).toBeNull();
  });

  it('emits a full run of daily buckets including zeros', () => {
    const result = computeAnalytics(items, scans, 0, 7, NOW);
    expect(result.scans_per_day).toHaveLength(7);
    expect(result.scans_per_day.some((point) => point.count === 0)).toBe(true);
    // Chronological order.
    const dates = result.scans_per_day.map((point) => point.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('passes the recipe count straight through', () => {
    expect(computeAnalytics(items, scans, 5, 30, NOW).recipes_generated).toBe(5);
  });

  it('reports no money or carbon estimate', () => {
    // These keys must not exist: Fresora has no price or emissions data.
    const result = computeAnalytics(items, scans, 0, 30, NOW) as unknown as Record<string, unknown>;
    expect(result.money_saved).toBeUndefined();
    expect(result.carbon_saved).toBeUndefined();
  });
});

// --- Shopping -------------------------------------------------------------

describe('buildShoppingSuggestions', () => {
  it('lists what is currently in the kitchen', () => {
    const result = buildShoppingSuggestions(
      [item({ id: 'a', food_name: 'Tomato' }), item({ id: 'b', food_name: 'Spinach' })],
      NOW,
    );
    expect(result.alreadyHave).toEqual(['Spinach', 'Tomato']);
  });

  it('suggests a restock for something consumed and now absent', () => {
    const result = buildShoppingSuggestions(
      [
        item({
          id: 'gone',
          food_name: 'Milk',
          resolution: 'consumed',
          resolved_at: daysAgo(3),
        }),
      ],
      NOW,
    );
    expect(result.suggested).toEqual(['Milk']);
  });

  it('never suggests restocking something that was discarded', () => {
    // Suggesting a repurchase of food the user threw away untouched would
    // encourage exactly the waste this app exists to prevent.
    const result = buildShoppingSuggestions(
      [
        item({
          id: 'binned',
          food_name: 'Spinach',
          resolution: 'discarded',
          resolved_at: daysAgo(2),
        }),
      ],
      NOW,
    );
    expect(result.suggested).toEqual([]);
  });

  it('does not suggest something already in stock', () => {
    const result = buildShoppingSuggestions(
      [
        item({ id: 'have', food_name: 'Tomato' }),
        item({
          id: 'used',
          food_name: 'Tomato',
          resolution: 'consumed',
          resolved_at: daysAgo(2),
        }),
      ],
      NOW,
    );
    expect(result.suggested).toEqual([]);
    expect(result.alreadyHave).toEqual(['Tomato']);
  });

  it('ignores consumption older than the lookback window', () => {
    const result = buildShoppingSuggestions(
      [
        item({
          id: 'ancient',
          food_name: 'Milk',
          resolution: 'consumed',
          resolved_at: daysAgo(90),
        }),
      ],
      NOW,
      30,
    );
    expect(result.suggested).toEqual([]);
  });
});

describe('daysSince', () => {
  it('floors to whole days and never goes negative', () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3);
    expect(daysSince(daysAhead(5), NOW)).toBe(0);
  });
});
