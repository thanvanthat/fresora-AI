import { Platform, type TextStyle } from 'react-native';

/**
 * Two families: an editorial serif for display copy, a neutral sans for UI.
 *
 * We deliberately use the platform serif/sans rather than bundling webfonts.
 * Android ships Noto Serif under the alias 'serif'; iOS ships Georgia. Both
 * read as editorial and cost nothing to load, so there is no font-loading
 * flash on first paint.
 *
 * To switch to DM Serif Display / Inter later, install the font and change
 * only DISPLAY_FAMILY and BODY_FAMILY below -- nothing else references a
 * family name directly.
 */
export const DISPLAY_FAMILY = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia, serif',
});

export const BODY_FAMILY = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

const display = (
  fontSize: number,
  lineHeight: number,
  letterSpacing = -0.4,
): TextStyle => ({
  fontFamily: DISPLAY_FAMILY,
  fontSize,
  lineHeight,
  letterSpacing,
  fontWeight: '400',
});

const body = (
  fontSize: number,
  lineHeight: number,
  fontWeight: TextStyle['fontWeight'] = '400',
  letterSpacing = 0,
): TextStyle => ({
  fontFamily: BODY_FAMILY,
  fontSize,
  lineHeight,
  fontWeight,
  letterSpacing,
});

export const typography = {
  /** "Know your food." -- hero only, one per screen at most. */
  hero: display(42, 48, -1),
  display: display(34, 40, -0.8),
  title: display(27, 34, -0.5),
  subtitle: display(21, 28, -0.3),

  /** The big freshness number. Tabular so digits don't jitter when counting. */
  score: {
    ...display(60, 64, -2),
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
  },
  scoreSmall: {
    ...display(30, 34, -1),
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
  },

  bodyLg: body(17, 26),
  body: body(15, 23),
  bodySm: body(13, 20),

  label: body(15, 20, '600'),
  labelSm: body(13, 18, '600'),

  /** Section eyebrows: "NEEDS YOUR ATTENTION" */
  eyebrow: body(11, 16, '700', 1.4),
  caption: body(12, 17, '500'),
  button: body(16, 22, '600', 0.2),
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    lineHeight: 19,
  } as TextStyle,
} as const;

export type TypographyKey = keyof typeof typography;
