import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { MIN_TOUCH, colors, palette, radius, shadows, spacing, typography } from '../theme';
import { Icon, type IconName } from './Icon';
import { Label } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Puts the icon after the label, e.g. a forward chevron. */
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const HEIGHTS: Record<Size, number> = { sm: 40, md: 52, lg: 58 };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  accessibilityHint,
}: ButtonProps) {
  const inert = disabled || loading;
  const tone = TONES[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          height: Math.max(HEIGHTS[size], MIN_TOUCH),
          backgroundColor: pressed ? tone.pressedBg : tone.bg,
          borderColor: tone.border,
          borderWidth: tone.border === 'transparent' ? 0 : 1.5,
        },
        variant === 'primary' && !inert ? shadows.sm : null,
        fullWidth ? styles.fullWidth : styles.hugContent,
        inert ? styles.inert : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone.fg} size="small" />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 19} color={tone.fg} /> : null}
          <Label style={[typography.button, { color: tone.fg }]}>{label}</Label>
          {iconRight ? (
            <Icon name={iconRight} size={size === 'sm' ? 16 : 19} color={tone.fg} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const TONES: Record<Variant, { bg: string; pressedBg: string; fg: string; border: string }> = {
  primary: {
    bg: colors.primary,
    pressedBg: colors.primaryPressed,
    fg: colors.textOnPrimary,
    border: 'transparent',
  },
  secondary: {
    bg: 'transparent',
    pressedBg: colors.surfaceAlt,
    fg: colors.primary,
    border: colors.primary,
  },
  ghost: {
    bg: 'transparent',
    pressedBg: colors.surfaceAlt,
    fg: colors.primary,
    border: 'transparent',
  },
  danger: {
    bg: 'transparent',
    pressedBg: palette.red100,
    fg: palette.red600,
    border: palette.red500,
  },
};

/** Convenience wrappers so call sites read as the design system does. */
export const PrimaryButton = (props: Omit<ButtonProps, 'variant'>) => (
  <Button {...props} variant="primary" />
);

export const SecondaryButton = (props: Omit<ButtonProps, 'variant'>) => (
  <Button {...props} variant="secondary" />
);

interface IconButtonProps {
  icon: IconName;
  onPress: () => void;
  /** Required: an icon-only control has no visible label to announce. */
  accessibilityLabel: string;
  size?: number;
  color?: string;
  background?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  badge?: number;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 22,
  color = colors.textPrimary,
  background = 'transparent',
  disabled = false,
  style,
  badge,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      // Expands the tap area past the visual bounds without affecting layout.
      hitSlop={10}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: pressed ? colors.surfaceAlt : background },
        disabled ? styles.inert : null,
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color} />
      {badge !== undefined && badge > 0 ? (
        <View style={styles.badge}>
          <Label style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Label>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Pill-shaped choice used for suggested questions and filter chips. */
interface ChipProps {
  label: string;
  onPress: () => void;
  selected?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

export function Chip({ label, onPress, selected = false, icon, style }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? colors.primary
            : pressed
              ? colors.surfaceAlt
              : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
        },
        style,
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={15}
          color={selected ? colors.textOnPrimary : colors.textSecondary}
        />
      ) : null}
      <LabelSmText selected={selected}>{label}</LabelSmText>
    </Pressable>
  );
}

/** Small helper so Chip's label colour stays in one place. */
function LabelSmText({ children, selected }: { children: ReactNode; selected: boolean }) {
  return (
    <Label
      style={{
        fontSize: 14,
        color: selected ? colors.textOnPrimary : colors.textPrimary,
      }}
    >
      {children}
    </Label>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  fullWidth: { alignSelf: 'stretch' },
  hugContent: { alignSelf: 'flex-start' },
  inert: { opacity: 0.45 },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: palette.red500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.textOnPrimary,
    fontSize: 11,
    lineHeight: 14,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
