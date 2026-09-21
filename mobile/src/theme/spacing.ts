/** 4pt spacing scale. Editorial layouts need generous, predictable rhythm. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
  giant: 72,
} as const;

/** Horizontal page gutter. Every screen uses this so edges line up app-wide. */
export const GUTTER = spacing.xl;

/** Minimum accessible touch target (WCAG 2.1 AA / platform guidance). */
export const MIN_TOUCH = 44;
