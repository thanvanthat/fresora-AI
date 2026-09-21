import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, PrimaryButton, SecondaryButton } from '../../src/components/Button';
import { InfoCard } from '../../src/components/FoodCard';
import { Body, Display, Eyebrow } from '../../src/components/Text';
import { SUPABASE_CONFIGURED } from '../../src/constants/config';
import { LeafMark } from '../../src/features/splash/SplashBrand';
import { useTranslation } from '../../src/i18n';
import { GUTTER, colors, spacing } from '../../src/theme';

/**
 * Welcome / auth entry.
 *
 * When Supabase is not configured this screen says so plainly and offers the
 * on-device route, rather than showing sign-in fields that cannot work. An
 * auth form that always fails is worse than no auth form.
 */
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.huge }]}>
      <View style={styles.brand}>
        <LeafMark size={54} />
        <Eyebrow style={styles.eyebrow}>{t('common.appName')}</Eyebrow>
      </View>

      <View style={styles.hero}>
        <Display>{t('auth.welcomeTitle')}</Display>
        <Display style={styles.heroSecond}>{t('auth.welcomeSubtitle')}</Display>
        <Body style={styles.positioning}>{t('common.positioning')}</Body>
      </View>

      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.xl }]}>
        {SUPABASE_CONFIGURED ? (
          <>
            <PrimaryButton
              label={t('auth.signIn')}
              size="lg"
              onPress={() => router.push('/(auth)/sign-in')}
            />
            <SecondaryButton
              label={t('auth.signUp')}
              onPress={() => router.push('/(auth)/sign-up')}
            />
            <Button
              label={t('auth.continueOffline')}
              variant="ghost"
              onPress={() => router.replace('/(tabs)')}
            />
          </>
        ) : (
          <>
            <InfoCard
              title={t('auth.notConfigured')}
              body={t('auth.offlineExplainer')}
              icon="info"
              tone="sage"
              style={styles.notice}
            />
            <PrimaryButton
              label={t('common.continue')}
              size="lg"
              onPress={() => router.replace('/(tabs)')}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: GUTTER,
  },
  brand: {
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  eyebrow: {
    letterSpacing: 2,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
  },
  heroSecond: {
    marginTop: -spacing.xs,
    color: colors.secondary,
  },
  positioning: {
    marginTop: spacing.base,
    maxWidth: 300,
    lineHeight: 23,
  },
  actions: {
    gap: spacing.md,
  },
  notice: {
    marginBottom: spacing.sm,
  },
});
