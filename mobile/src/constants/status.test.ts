import {
  ATTENTION_STATUSES,
  STATUS_META,
  byConsumePriority,
  isUsableInRecipes,
  needsAttention,
  statusForScore,
} from './status';
import { statusColors } from '../theme';
import { FOOD_STATUSES, type FoodStatus } from '../types';

/**
 * Status semantics.
 *
 * These rules decide what the user is told to do with their food, and they are
 * duplicated in the backend (`app/freshness.py`). The band assertions below are
 * the guard against the two drifting apart.
 */

describe('STATUS_META', () => {
  it('covers every status exactly once', () => {
    expect(Object.keys(STATUS_META).sort()).toEqual([...FOOD_STATUSES].sort());
  });

  it('gives every status a label key, icon and priority', () => {
    for (const status of FOOD_STATUSES) {
      const meta = STATUS_META[status];
      expect(meta.labelKey).toMatch(/^status\./);
      expect(meta.icon).toBeTruthy();
      expect(typeof meta.priority).toBe('number');
    }
  });

  it('has a matching colour set in the theme for every status', () => {
    // The two are deliberately separate modules; this is the join.
    for (const status of FOOD_STATUSES) {
      const tone = statusColors[status];
      expect(tone).toBeDefined();
      expect(tone.fg).toBeTruthy();
      expect(tone.bg).toBeTruthy();
      expect(tone.border).toBeTruthy();
    }
  });

  it('pairs each status with a distinct icon, so colour is never the only cue', () => {
    const icons = FOOD_STATUSES.map((status) => STATUS_META[status].icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('orders priority so attention statuses come first', () => {
    // nearly_spoiled is the most urgent, spoiled the least (nothing to save).
    expect(STATUS_META.nearly_spoiled.priority).toBeLessThan(
      STATUS_META.overripe.priority,
    );
    expect(STATUS_META.overripe.priority).toBeLessThan(STATUS_META.fresh.priority);
    expect(STATUS_META.fresh.priority).toBeLessThan(STATUS_META.spoiled.priority);
  });

  it('has contiguous, non-overlapping score bands covering 0-100', () => {
    const bands = FOOD_STATUSES.map((status) => STATUS_META[status].scoreRange).sort(
      (a, b) => a[0] - b[0],
    );

    expect(bands[0][0]).toBe(0);
    expect(bands[bands.length - 1][1]).toBe(100);

    for (let index = 1; index < bands.length; index += 1) {
      // Each band starts exactly one above the previous band's top.
      expect(bands[index][0]).toBe(bands[index - 1][1] + 1);
    }
  });

  it('matches the thresholds the backend uses', () => {
    // Mirrors FRESH_MIN / NEARLY_MIN / OVERRIPE_MIN in app/freshness.py. If a
    // threshold moves on the server, this test fails and points at the drift.
    expect(STATUS_META.fresh.scoreRange).toEqual([80, 100]);
    expect(STATUS_META.nearly_spoiled.scoreRange).toEqual([45, 79]);
    expect(STATUS_META.overripe.scoreRange).toEqual([25, 44]);
    expect(STATUS_META.spoiled.scoreRange).toEqual([0, 24]);
  });
});

describe('recipe eligibility', () => {
  it('permits everything except spoiled', () => {
    expect(isUsableInRecipes('fresh')).toBe(true);
    expect(isUsableInRecipes('nearly_spoiled')).toBe(true);
    expect(isUsableInRecipes('overripe')).toBe(true);
    expect(isUsableInRecipes('spoiled')).toBe(false);
  });

  it('is the single source for the rule', () => {
    // Anything the UI offers as an ingredient must pass this predicate.
    const usable = FOOD_STATUSES.filter(isUsableInRecipes);
    expect(usable).not.toContain('spoiled');
    expect(usable).toHaveLength(3);
  });
});

describe('needsAttention', () => {
  it('flags nearly spoiled and overripe only', () => {
    expect(ATTENTION_STATUSES).toEqual(['nearly_spoiled', 'overripe']);
    expect(needsAttention('nearly_spoiled')).toBe(true);
    expect(needsAttention('overripe')).toBe(true);
    expect(needsAttention('fresh')).toBe(false);
    // Spoiled needs disposal, not attention -- it is past saving.
    expect(needsAttention('spoiled')).toBe(false);
  });
});

describe('statusForScore', () => {
  it('maps each band to its status', () => {
    expect(statusForScore(100)).toBe('fresh');
    expect(statusForScore(80)).toBe('fresh');
    expect(statusForScore(79)).toBe('nearly_spoiled');
    expect(statusForScore(45)).toBe('nearly_spoiled');
    expect(statusForScore(44)).toBe('overripe');
    expect(statusForScore(25)).toBe('overripe');
    expect(statusForScore(24)).toBe('spoiled');
    expect(statusForScore(0)).toBe('spoiled');
  });

  it('folds overripe into nearly spoiled for foods that do not ripen', () => {
    // Bread is never "overripe" -- the backend applies the same rule.
    expect(statusForScore(30, false)).toBe('nearly_spoiled');
    expect(statusForScore(30, true)).toBe('overripe');
  });

  it('agrees with the declared bands for every score', () => {
    for (let score = 0; score <= 100; score += 1) {
      const status = statusForScore(score);
      const [low, high] = STATUS_META[status].scoreRange;
      expect(score).toBeGreaterThanOrEqual(low);
      expect(score).toBeLessThanOrEqual(high);
    }
  });
});

describe('byConsumePriority', () => {
  const entry = (status: FoodStatus, days: number | null) => ({
    status,
    estimated_remaining_days: days,
  });

  it('sorts by urgency before days remaining', () => {
    const sorted = [
      entry('fresh', 1),
      entry('spoiled', 0),
      entry('nearly_spoiled', 5),
    ].sort(byConsumePriority);

    expect(sorted.map((item) => item.status)).toEqual([
      'nearly_spoiled',
      'fresh',
      'spoiled',
    ]);
  });

  it('breaks ties on fewest days remaining', () => {
    const sorted = [
      entry('nearly_spoiled', 3),
      entry('nearly_spoiled', 1),
      entry('nearly_spoiled', 2),
    ].sort(byConsumePriority);

    expect(sorted.map((item) => item.estimated_remaining_days)).toEqual([1, 2, 3]);
  });

  it('puts items with no estimate last within their status', () => {
    const sorted = [entry('fresh', null), entry('fresh', 9)].sort(byConsumePriority);
    expect(sorted[0].estimated_remaining_days).toBe(9);
  });
});
