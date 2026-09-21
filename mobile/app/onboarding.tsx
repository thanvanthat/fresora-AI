import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, PrimaryButton } from '../src/components/Button';
import { Icon, type IconName } from '../src/components/Icon';
import { SafetyNotice } from '../src/components/States';
import { Body, Display } from '../src/components/Text';
import { LeafMark } from '../src/features/splash/SplashBrand';
import { useTranslation } from '../src/i18n';
import { useAppStore } from '../src/store/app';
import { GUTTER, colors, radius, spacing } from '../src/theme';

/**
 * Onboarding: four pages, swipeable, with a skip.
 *
 * The final page carries the food-safety notice, so the app's central caveat is
 * stated before anyone scans anything rather than buried in About.
 */

const { width } = Dimensions.get('window');

interface Page {
  titleKey: string;
  bodyKey: string;
  icon: IconName;
}

const PAGES: Page[] = [
  { titleKey: 'onboarding.title1', bodyKey: 'onboarding.body1', icon: 'camera' },
  { titleKey: 'onboarding.title2', bodyKey: 'onboarding.body2', icon: 'eye' },
  { titleKey: 'onboarding.title3', bodyKey: 'onboarding.body3', icon: 'chef' },
  { titleKey: 'onboarding.title4', bodyKey: 'onboarding.body4', icon: 'chart' },
];

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const setOnboarded = useAppStore((state) => state.setOnboarded);

  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Page>>(null);

  const finish = () => {
    setOnboarded(true);
    router.replace('/(tabs)');
  };

  const next = () => {
    if (index >= PAGES.length - 1) {
      finish();
      return;
    }
    const target = index + 1;
    setIndex(target);
    listRef.current?.scrollToOffset({ offset: target * width, animated: true });
  };

  /** Keeps the dots in step with a manual swipe. */
  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  const isLast = index === PAGES.length - 1;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <LeafMark size={26} />
        <Button
          label={t('common.skip')}
          variant="ghost"
          size="sm"
          fullWidth={false}
          onPress={finish}
        />
      </View>

      <FlatList
        ref={listRef}
        data={PAGES}
        keyExtractor={(page) => page.titleKey}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={({ item }) => (
          <View style={[styles.page, { width }]}>
            <View style={styles.illustration}>
              <Icon name={item.icon} size={46} color={colors.primary} />
            </View>
            <Display align="center" style={styles.title}>
              {t(item.titleKey)}
            </Display>
            <Body align="center" style={styles.body}>
              {t(item.bodyKey)}
            </Body>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.dots} accessibilityRole="tablist">
          {PAGES.map((page, dotIndex) => (
            <View
              key={page.titleKey}
              style={[styles.dot, dotIndex === index ? styles.dotActive : null]}
            />
          ))}
        </View>

        {isLast ? <SafetyNotice text={t('safety.fullNotice')} style={styles.notice} /> : null}

        <PrimaryButton
          label={isLast ? t('onboarding.getStarted') : t('common.next')}
          iconRight={isLast ? undefined : 'forward'}
          size="lg"
          onPress={next}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
    paddingVertical: spacing.md,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: GUTTER + spacing.sm,
    gap: spacing.base,
  },
  illustration: {
    width: 120,
    height: 120,
    borderRadius: radius.xxl,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    maxWidth: 320,
  },
  body: {
    maxWidth: 320,
    fontSize: 16,
    lineHeight: 25,
  },
  footer: {
    paddingHorizontal: GUTTER,
    gap: spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 22,
  },
  notice: {
    marginBottom: spacing.xs,
  },
});
