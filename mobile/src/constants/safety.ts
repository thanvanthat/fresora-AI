/**
 * Food-safety language. These strings are intentionally centralised so the app
 * can never drift into claiming a visual model has verified food safety.
 *
 * They are i18n keys, resolved through t() at the call site.
 */
export const SAFETY_KEYS = {
  /** The full notice. Shown on analysis results, onboarding and About. */
  fullNotice: 'safety.fullNotice',
  /** One-line version for dense surfaces. */
  shortNotice: 'safety.shortNotice',
  /** Shown when an item is assessed as spoiled. */
  spoiledGuidance: 'safety.spoiledGuidance',
  /** Shown before a recipe that uses items needing attention. */
  recipeCaution: 'safety.recipeCaution',
  /** Shown when confidence is low. */
  lowConfidence: 'safety.lowConfidence',
} as const;

/** Below this identification confidence we surface the low-confidence caveat. */
export const LOW_CONFIDENCE_THRESHOLD = 0.55;
