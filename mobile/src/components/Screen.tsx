import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '../i18n';
import { useOnline } from '../store/app';
import { GUTTER, colors, spacing } from '../theme';
import { IconButton } from './Button';
import { Eyebrow, Title } from './Text';
import { OfflineBanner } from './States';

interface ScreenProps {
  children: ReactNode;
  /** Large editorial title. */
  title?: string;
  /** Small uppercase line above the title. */
  eyebrow?: string;
  /** Shows a back chevron in the header. */
  showBack?: boolean;
  /** Rendered at the right of the header row. */
  headerRight?: ReactNode;
  /** Set false for a fixed layout, e.g. the camera. */
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Extra bottom padding so the tab bar never covers the last item. */
  tabBarPadding?: boolean;
  /** Set false to hide the offline banner (the camera has its own). */
  showOfflineBanner?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Wraps content in a KeyboardAvoidingView. Use on form screens. */
  keyboardAware?: boolean;
}

/**
 * Standard screen scaffold.
 *
 * Owns safe-area insets, the page gutter, the header, pull-to-refresh, the
 * offline banner and tab-bar clearance -- so no screen re-implements them and
 * every screen's edges line up (rule 64).
 */
export function Screen({
  children,
  title,
  eyebrow,
  showBack = false,
  headerRight,
  scroll = true,
  onRefresh,
  refreshing = false,
  tabBarPadding = true,
  showOfflineBanner = true,
  contentStyle,
  keyboardAware = false,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const { t } = useTranslation();

  const header =
    title || showBack || headerRight ? (
      <View style={styles.header}>
        {showBack ? (
          <IconButton
            icon="back"
            onPress={() => router.back()}
            accessibilityLabel={t('common.back')}
            style={styles.back}
          />
        ) : null}
        <View style={styles.headerText}>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          {title ? (
            <Title heading style={eyebrow ? styles.titleWithEyebrow : undefined}>
              {title}
            </Title>
          ) : null}
        </View>
        {headerRight}
      </View>
    ) : null;

  const body = (
    <>
      {header}
      {showOfflineBanner && !online ? (
        <OfflineBanner title={t('offline.banner')} body={t('offline.bannerBody')} />
      ) : null}
      {children}
    </>
  );

  const bottomPadding =
    (tabBarPadding ? 96 : spacing.xxl) + (Platform.OS === 'ios' ? 0 : insets.bottom);

  const inner = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[{ paddingBottom: bottomPadding }, contentStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        ) : undefined
      }
    >
      {body}
    </ScrollView>
  ) : (
    <View style={[styles.flex, contentStyle]}>{body}</View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </View>
  );
}

/** Applies the standard horizontal gutter. */
export function Gutter({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.gutter, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  gutter: {
    paddingHorizontal: GUTTER,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: GUTTER,
    paddingTop: spacing.base,
    paddingBottom: spacing.lg,
  },
  headerText: {
    flex: 1,
  },
  titleWithEyebrow: {
    marginTop: spacing.xs,
  },
  back: {
    marginLeft: -spacing.md,
    marginTop: -spacing.xs,
  },
});
