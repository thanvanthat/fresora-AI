/**
 * Fresora colour tokens.
 *
 * Nature + premium editorial. Every colour in the app comes from here --
 * never inline a hex value in a component.
 */

export const palette = {
  // Greens -- the brand spine
  forest900: '#14291C',
  forest800: '#1B3A26',
  forest700: '#215031',
  forest600: '#2C6A41',
  sage500: '#6B9A78',
  sage300: '#A8C4AF',
  sage200: '#CBDCCF',
  sage100: '#E4EDE6',

  // Warm neutrals -- the editorial paper
  cream50: '#FBF8F2',
  cream100: '#F5F0E6',
  white: '#FFFFFF',
  black: '#000000',
  surface: '#FFFEFB',

  // Status
  amber600: '#C8880E',
  amber500: '#E0A526',
  amber100: '#FAEFD5',
  orange600: '#C4661C',
  orange500: '#E07E32',
  orange100: '#FBE8D9',
  red600: '#B4463F',
  red500: '#D2635B',
  red100: '#F9E3E1',
  blue600: '#2F6B8F',
  blue100: '#DDEAF2',

  // Text
  charcoal900: '#1A1F1B',
  charcoal700: '#3A423C',
  greyGreen600: '#6B7770',
  greyGreen400: '#98A29B',

  // Lines
  border: '#E6E0D3',
  borderSage: '#D5E2D8',
} as const;

export const colors = {
  primary: palette.forest700,
  primaryDark: palette.forest900,
  primaryPressed: palette.forest800,
  secondary: palette.sage500,

  background: palette.cream50,
  surface: palette.surface,
  surfaceAlt: palette.sage100,
  surfaceSunken: palette.cream100,

  textPrimary: palette.charcoal900,
  textSecondary: palette.greyGreen600,
  textTertiary: palette.greyGreen400,
  textOnPrimary: palette.white,

  border: palette.border,
  borderStrong: palette.borderSage,

  overlay: 'rgba(20, 41, 28, 0.55)',
  scrim: 'rgba(20, 41, 28, 0.82)',

  /**
   * Camera chrome. This sits over a live camera feed rather than a themed
   * surface, so it is the one place allowed to step outside the cream/forest
   * palette -- translucent white and black are the only things legible over
   * arbitrary video.
   */
  cameraBackdrop: palette.black,
  cameraGlass: 'rgba(20, 41, 28, 0.45)',
  onCamera: 'rgba(255, 255, 255, 0.92)',
  onCameraMuted: 'rgba(255, 255, 255, 0.82)',
  onCameraFaint: 'rgba(255, 255, 255, 0.28)',
  cameraTextShadow: 'rgba(0, 0, 0, 0.6)',
} as const;

/**
 * Status colour sets. Each one carries a full trio so a status never relies on
 * hue alone -- callers pair these with a label and an icon (accessibility 38).
 */
export const statusColors = {
  fresh: { fg: palette.forest700, bg: palette.sage100, border: palette.sage300 },
  nearly_spoiled: { fg: palette.amber600, bg: palette.amber100, border: palette.amber500 },
  overripe: { fg: palette.orange600, bg: palette.orange100, border: palette.orange500 },
  spoiled: { fg: palette.red600, bg: palette.red100, border: palette.red500 },
  unknown: { fg: palette.greyGreen600, bg: palette.cream100, border: palette.border },
  processing: { fg: palette.blue600, bg: palette.blue100, border: palette.blue600 },
} as const;

export type StatusColorKey = keyof typeof statusColors;
