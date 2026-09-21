import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { colors } from '../theme';

/**
 * Single icon surface for the whole app.
 *
 * Semantic names map to Feather glyphs here, so a screen asks for `"fresh"`
 * rather than picking a glyph itself. Swapping icon sets later is a change to
 * this one map.
 *
 * Feather ships inside `@expo/vector-icons`, which comes with Expo -- no extra
 * dependency, and one consistent stroke weight across every screen.
 */
const GLYPHS = {
  // Navigation
  home: 'home',
  scan: 'camera',
  inventory: 'archive',
  recipes: 'book-open',
  you: 'user',

  // Status
  fresh: 'check-circle',
  leaf: 'feather',
  clock: 'clock',
  'alert-triangle': 'alert-triangle',
  'x-circle': 'x-circle',

  // Actions
  back: 'chevron-left',
  forward: 'chevron-right',
  up: 'chevron-up',
  down: 'chevron-down',
  close: 'x',
  check: 'check',
  plus: 'plus',
  search: 'search',
  filter: 'sliders',
  trash: 'trash-2',
  edit: 'edit-2',
  refresh: 'refresh-cw',
  send: 'send',
  share: 'share-2',
  more: 'more-horizontal',

  // Scanner
  gallery: 'image',
  flash: 'zap',
  'flash-off': 'zap-off',
  flip: 'rotate-cw',
  history: 'rotate-ccw',

  // Domain
  sparkle: 'star',
  chef: 'coffee',
  chart: 'bar-chart-2',
  bell: 'bell',
  cart: 'shopping-cart',
  globe: 'globe',
  lock: 'lock',
  info: 'info',
  shield: 'shield',
  fridge: 'thermometer',
  snowflake: 'cloud-snow',
  sun: 'sun',
  box: 'box',
  eye: 'eye',
  wifi: 'wifi-off',
  help: 'help-circle',
  'log-out': 'log-out',
  settings: 'settings',
  trending: 'trending-up',
  calendar: 'calendar',
  camera: 'camera',
  message: 'message-circle',
} as const;

export type IconName = keyof typeof GLYPHS;

interface IconProps {
  name: IconName;
  size?: number;
  /** ColorValue, not string: navigator callbacks hand us their own tint type. */
  color?: ColorValue;
  style?: ComponentProps<typeof Feather>['style'];
}

export function Icon({ name, size = 20, color = colors.textPrimary, style }: IconProps) {
  return (
    <Feather
      name={GLYPHS[name]}
      size={size}
      color={color}
      style={style}
      // Icons always sit beside a text label, so they are decorative to a
      // screen reader and would otherwise be announced twice.
      aria-hidden
    />
  );
}
