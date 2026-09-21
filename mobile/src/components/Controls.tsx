import { Children, useState } from 'react';
import {
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GUTTER, MIN_TOUCH, colors, palette, radius, shadows, spacing, typography } from '../theme';
import { Button, IconButton } from './Button';
import { Divider } from './Card';
import { Icon, type IconName } from './Icon';
import { Body, Caption, Label, Subtitle, Title } from './Text';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Shown as a small count beside the label, e.g. a tab badge. */
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Scrolls horizontally when the options will not fit (4+ tabs). */
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Inset pill control, for two or three mutually exclusive choices. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  scrollable = false,
  style,
}: SegmentedControlProps<T>) {
  const content = options.map((option) => {
    const active = option.value === value;
    return (
      <Pressable
        key={option.value}
        onPress={() => onChange(option.value)}
        accessibilityRole="tab"
        accessibilityLabel={option.label}
        accessibilityState={{ selected: active }}
        style={[
          styles.segment,
          active ? styles.segmentActive : null,
          scrollable ? styles.segmentHug : styles.segmentFlex,
        ]}
      >
        <Label
          style={{
            color: active ? colors.primary : colors.textSecondary,
            fontSize: 14,
          }}
          numberOfLines={1}
        >
          {option.label}
          {option.count !== undefined ? `  ${option.count}` : ''}
        </Label>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.segmentedScroll, style]}
      >
        {content}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.segmented, style]} accessibilityRole="tablist">
      {content}
    </View>
  );
}

interface TabsProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}

/** Underlined tabs, for primary in-screen navigation. */
export function Tabs<T extends string>({ options, value, onChange, style }: TabsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.tabs, style]}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            style={styles.tab}
          >
            <Label
              style={{
                color: active ? colors.textPrimary : colors.textTertiary,
                fontSize: 15,
              }}
            >
              {option.label}
              {option.count !== undefined ? ` (${option.count})` : ''}
            </Label>
            <View style={[styles.tabRule, active ? styles.tabRuleActive : null]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Fraction of the screen the sheet may occupy before it scrolls. */
  maxHeightRatio?: number;
}

/**
 * Bottom sheet built on the platform Modal.
 *
 * A gesture-driven sheet would need a dedicated library; for the picker-style
 * uses here (choose a language, correct a food name, pick a storage mode) a
 * tap-to-dismiss modal is the whole requirement, so that is what this is.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  maxHeightRatio = 0.8,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + spacing.lg, maxHeight: `${maxHeightRatio * 100}%` },
        ]}
      >
        <View style={styles.grabber} />
        {title ? (
          <View style={styles.sheetHeader}>
            <Subtitle heading>{title}</Subtitle>
            <IconButton icon="close" onPress={onClose} accessibilityLabel="Close" size={20} />
          </View>
        ) : null}
        <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </View>
    </RNModal>
  );
}

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

/** Centred confirmation dialog for destructive actions. */
export function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmModalProps) {
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.modal}>
          <Title heading>{title}</Title>
          {body ? <Body style={styles.modalBody}>{body}</Body> : null}
          <View style={styles.modalActions}>
            <Button
              label={cancelLabel}
              onPress={onCancel}
              variant="secondary"
              style={styles.modalButton}
            />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'danger' : 'primary'}
              style={styles.modalButton}
            />
          </View>
        </View>
      </View>
    </RNModal>
  );
}

/** A labelled row that opens a picker or navigates onward. */
interface SettingRowProps {
  label: string;
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  /** Renders a switch instead of a chevron. */
  toggle?: { value: boolean; onChange: (next: boolean) => void };
  destructive?: boolean;
  caption?: string;
}

export function SettingRow({
  label,
  value,
  icon,
  onPress,
  toggle,
  destructive = false,
  caption,
}: SettingRowProps) {
  const tint = destructive ? palette.red600 : colors.textPrimary;

  const body = (
    <View style={styles.settingRow}>
      {icon ? (
        <View style={styles.settingIcon}>
          <Icon name={icon} size={18} color={destructive ? palette.red600 : colors.secondary} />
        </View>
      ) : null}
      <View style={styles.settingText}>
        <Label style={{ color: tint }}>{label}</Label>
        {caption ? <Caption style={styles.settingCaption}>{caption}</Caption> : null}
      </View>
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.surface}
          accessibilityLabel={label}
        />
      ) : (
        <View style={styles.settingValue}>
          {value ? <Body numberOfLines={1}>{value}</Body> : null}
          {onPress ? <Icon name="forward" size={18} color={colors.textTertiary} /> : null}
        </View>
      )}
    </View>
  );

  if (toggle || !onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={value ? { text: value } : undefined}
      style={({ pressed }) => (pressed ? { backgroundColor: colors.surfaceAlt } : undefined)}
    >
      {body}
    </Pressable>
  );
}

/**
 * Grouped settings list with hairlines between rows.
 *
 * Takes one row or many: `Children.toArray` normalises the single-child case
 * and drops the nulls that conditional rows produce, so a group with one
 * visible row still renders without a trailing divider.
 */
export function SettingGroup({ children }: { children: React.ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.settingGroup}>
      {rows.map((row, index) => (
        <View key={index}>
          {row}
          {index < rows.length - 1 ? <Divider style={styles.settingDivider} /> : null}
        </View>
      ))}
    </View>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'decimal-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  multiline?: boolean;
  /** Text after the label, e.g. "Optional". */
  hint?: string;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  autoComplete?: 'email' | 'password' | 'name' | 'off';
}

/** Labelled text field with inline validation messaging. */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  multiline = false,
  hint,
  style,
  inputStyle,
  autoComplete = 'off',
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={[styles.field, style]}>
      <View style={styles.fieldLabelRow}>
        <Label style={styles.fieldLabel}>{label}</Label>
        {hint ? <Caption>{hint}</Caption> : null}
      </View>
      <View
        style={[
          styles.inputWrap,
          focused ? styles.inputFocused : null,
          error ? styles.inputError : null,
          multiline ? styles.inputMultiline : null,
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={secureTextEntry && !revealed}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={!secureTextEntry}
          autoComplete={autoComplete}
          multiline={multiline}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
          style={[styles.input, multiline ? styles.inputMultilineText : null, inputStyle]}
        />
        {secureTextEntry ? (
          <IconButton
            icon="eye"
            onPress={() => setRevealed((prior) => !prior)}
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            size={18}
            color={colors.textTertiary}
          />
        ) : null}
      </View>
      {error ? (
        <Caption style={styles.fieldError} accessibilityRole="alert">
          {error}
        </Caption>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  segmentedScroll: {
    gap: spacing.sm,
    paddingHorizontal: GUTTER,
  },
  segment: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
  },
  segmentFlex: { flex: 1 },
  segmentHug: {
    backgroundColor: colors.surfaceSunken,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    ...shadows.xs,
  },
  tabs: {
    gap: spacing.xl,
    paddingHorizontal: GUTTER,
  },
  tab: {
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
  },
  tabRule: {
    height: 2,
    width: '100%',
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  tabRuleActive: {
    backgroundColor: colors.primary,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: GUTTER,
    paddingTop: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.base,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.base,
  },
  modalWrap: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: GUTTER,
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadows.lg,
  },
  modalBody: {
    lineHeight: 22,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  modalButton: {
    flex: 1,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  settingIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingText: {
    flex: 1,
  },
  settingCaption: {
    marginTop: 2,
    lineHeight: 16,
  },
  settingValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '45%',
  },
  settingGroup: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  settingDivider: {
    marginLeft: spacing.lg,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldLabel: {
    fontSize: 14,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    minHeight: 54,
  },
  inputFocused: {
    borderColor: colors.secondary,
  },
  inputError: {
    borderColor: palette.red500,
  },
  inputMultiline: {
    minHeight: 100,
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
  },
  input: {
    flex: 1,
    ...(typography.body as TextStyle),
    color: colors.textPrimary,
    paddingVertical: spacing.md,
  },
  inputMultilineText: {
    textAlignVertical: 'top',
    minHeight: 76,
  },
  fieldError: {
    color: palette.red600,
  },
});
