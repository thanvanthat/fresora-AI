import { Platform, type ViewStyle } from 'react-native';

/**
 * Soft, low-contrast elevation. iOS uses shadow*, Android uses elevation --
 * returning a single style object keeps call sites free of Platform checks.
 */
const make = (
  elevation: number,
  opacity: number,
  radiusPx: number,
  offsetY: number,
): ViewStyle =>
  Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#1B3A26',
      shadowOpacity: opacity,
      shadowRadius: radiusPx,
      shadowOffset: { width: 0, height: offsetY },
    },
    android: { elevation },
    default: {},
  }) as ViewStyle;

export const shadows = {
  none: {} as ViewStyle,
  xs: make(1, 0.05, 4, 1),
  sm: make(2, 0.06, 8, 2),
  md: make(4, 0.08, 16, 4),
  lg: make(8, 0.1, 24, 8),
  xl: make(14, 0.14, 32, 12),
} as const;
