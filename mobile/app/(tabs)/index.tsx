import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '../../src/components/Button';
import { Section, StatRow } from '../../src/components/Card';
import { AttentionCard, InfoCard, StatCard } from '../../src/components/FoodCard';
import { Gutter } from '../../src/components/Screen';
import { EmptyState, SafetyNotice, SkeletonList } from '../../src/components/States';
import { Body, Display, Eyebrow } from '../../src/components/Text';
import { LeafMark } from '../../src/features/splash/SplashBrand';
import { useAnalytics } from '../../src/hooks/useAnalytics';
import { useInventory } from '../../src/hooks/useInventory';
import { useTranslation } from '../../src/i18n';
import { useAppStore } from '../../src/store/app';
import { GUTTER, colors, spacing } from '../../src/theme';

/**
 * Home.
 *
 * Reads top to bottom as a single story: who you are, the one action that
 * matters, what your kitchen looks like, what needs you today, and what you
 * have saved. One primary action (Scan Food), everything else secondary.
 */

function greetingKey(hour: number): string {
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

export default function HomeScreen() {
  const { t, tPlural } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const profile = useAppStore((state) => state.profile);
  const { counts, attention, candidates, isLoading, refetch, isRefetching } = useInventory();
  const { data: analytics } = useAnalytics(7);

  const greeting = t(greetingKey(new Date().getHours()));
  const firstName = profile?.full_name?.trim().split(' ')[0];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
      showsVerticalScrollIndicator={false}
    >
      {/* --- Header ---------------------------------------------------- */}
      <Gutter>
        <View style={styles.brandRow}>
          <LeafMark size={26} />
          <Eyebrow>{t('common.appName')}</Eyebrow>
        </View>
        <Display style={styles.greeting}>
          {firstName ? `${greeting}, ${firstName} 👋` : `${greeting} 👋`}
        </Display>
        <Body style={styles.subtitle}>{t('home.subtitle')}</Body>
      </Gutter>

      {/* --- Primary action ------------------------------------------- */}
      <Gutter style={styles.actions}>
        <PrimaryButton
          label={t('home.scanFood')}
          icon="camera"
          size="lg"
          onPress={() => router.push('/scan')}
          accessibilityHint={t('scanner.prompt')}
        />
        <SecondaryButton
          label={t('home.addManually')}
          icon="plus"
          onPress={() => router.push('/add-food')}
        />
      </Gutter>

      {/* --- Status summary ------------------------------------------- */}
      <Section title={t('home.yourFood')}>
        <StatRow>
          <StatCard
            value={counts.fresh}
            label={t('home.freshCount')}
            tone="fresh"
            onPress={() => router.push('/inventory')}
          />
          <StatCard
            value={counts.attention}
            label={t('home.attentionCount')}
            tone="attention"
            onPress={() => router.push('/inventory')}
          />
          <StatCard
            value={counts.spoiled}
            label={t('home.spoiledCount')}
            tone="spoiled"
            onPress={() => router.push('/inventory')}
          />
        </StatRow>
      </Section>

      {/* --- Needs attention ------------------------------------------ */}
      {isLoading ? (
        <SkeletonList count={2} />
      ) : attention.length > 0 ? (
        <Section title={t('home.needsAttention')} gutter={false}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carousel}
          >
            {attention.slice(0, 6).map((item) => (
              <AttentionCard
                key={item.id}
                foodName={item.food_name}
                status={item.displayStatus}
                category={item.category}
                imageUri={item.image_uri}
                remaining={
                  item.displayRemaining === null
                    ? t('status.unknown')
                    : tPlural(
                        'common.aboutDay',
                        'common.aboutDays',
                        item.displayRemaining,
                      )
                }
                onPress={() => router.push(`/item/${item.id}`)}
              />
            ))}
          </ScrollView>
          <Gutter style={styles.carouselAction}>
            <SecondaryButton
              label={t('home.viewInventory')}
              iconRight="forward"
              onPress={() => router.push('/inventory')}
            />
          </Gutter>
        </Section>
      ) : counts.total > 0 ? (
        <Section>
          <InfoCard
            title={t('home.allClear')}
            body={t('home.allClearBody')}
            icon="leaf"
            tone="sage"
          />
        </Section>
      ) : (
        <EmptyState
          icon="leaf"
          title={t('inventory.emptyTitle')}
          body={t('inventory.emptyBody')}
          actionLabel={t('home.scanFood')}
          onAction={() => router.push('/scan')}
        />
      )}

      {/* --- Zero-waste opportunity ----------------------------------- */}
      {candidates.length >= 2 ? (
        <Section title={t('home.zeroWasteTitle')}>
          <InfoCard
            title={tPlural('home.rescueCountOne', 'home.rescueCount', attention.length || candidates.length)}
            body={t('recipes.emptyBody')}
            icon="chef"
            tone="sage"
            footer={
              <PrimaryButton
                label={t('home.generateRecipe')}
                icon="sparkle"
                onPress={() => router.push('/recipes')}
                style={styles.rescueButton}
              />
            }
          />
        </Section>
      ) : null}

      {/* --- This week ------------------------------------------------ */}
      {analytics && analytics.total_scans > 0 ? (
        <Section title={t('home.thisWeek')}>
          <StatRow>
            <StatCard value={analytics.total_scans} label={t('home.foodScanned')} />
            <StatCard value={analytics.items_rescued} label={t('home.foodRescued')} />
            <StatCard
              value={analytics.recipes_generated}
              label={t('home.recipesGenerated')}
            />
          </StatRow>
        </Section>
      ) : null}

      {/* --- Standing safety notice ----------------------------------- */}
      <Gutter>
        <SafetyNotice text={t('safety.shortNotice')} compact />
      </Gutter>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 110,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.base,
  },
  greeting: {
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  carousel: {
    paddingHorizontal: GUTTER,
    gap: spacing.base,
  },
  carouselAction: {
    marginTop: spacing.lg,
  },
  rescueButton: {
    marginTop: spacing.base,
  },
});
