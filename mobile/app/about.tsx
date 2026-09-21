import { StyleSheet, View } from 'react-native';

import { Pill } from '../src/components/Badge';
import { Card, Section } from '../src/components/Card';
import { Gutter, Screen } from '../src/components/Screen';
import { SafetyNotice } from '../src/components/States';
import { Body, Caption, Display, Eyebrow, Label } from '../src/components/Text';
import { API_BASE_URL, APP_VERSION, SUPABASE_CONFIGURED } from '../src/constants/config';
import { LeafMark } from '../src/features/splash/SplashBrand';
import { useTranslation } from '../src/i18n';
import { authMode } from '../src/services/auth';
import { useCapabilities } from '../src/store/app';
import { colors, spacing } from '../src/theme';

/**
 * About.
 *
 * States plainly how the assessment works, what it cannot do, and exactly which
 * components are active in this build. A user who wants to know whether a
 * number came from a trained model or a documented heuristic can find out here.
 */
export default function AboutScreen() {
  const { t } = useTranslation();
  const capabilities = useCapabilities();

  return (
    <Screen showBack title={t('profile.about')} tabBarPadding={false}>
      <Gutter style={styles.container}>
        <View style={styles.brand}>
          <LeafMark size={48} />
          <Display style={styles.name}>{t('common.appName')}</Display>
          <Body>{t('common.tagline')}</Body>
          <Caption>{t('common.positioning')}</Caption>
          <Pill label={`${t('profile.version')} ${APP_VERSION}`} />
        </View>

        {/* --- How it works ------------------------------------------ */}
        <Card>
          <Eyebrow>{t('profile.aiInformation')}</Eyebrow>
          <Body style={styles.body}>{t('profile.aiInformationBody')}</Body>

          <View style={styles.list}>
            <Row
              label="Food identification"
              value={
                capabilities.classifierAvailable
                  ? 'MobileNetV2 classifier'
                  : 'Disabled — name the food yourself'
              }
            />
            <Row label="Surface measurement" value="OpenCV (colour, defects, texture)" />
            <Row label="Freshness score" value="Documented deterministic formula" />
            <Row
              label="Recipes & assistant"
              value={
                capabilities.llmConfigured
                  ? 'AI provider + curated knowledge base'
                  : 'Curated knowledge base only'
              }
            />
            <Row
              label="Your data"
              value={
                authMode === 'local' && !SUPABASE_CONFIGURED
                  ? 'Stored on this device'
                  : 'Synced to your account'
              }
            />
            <Row label="Analysis server" value={API_BASE_URL} />
          </View>
        </Card>

        {/* --- Limits ------------------------------------------------- */}
        <Card tone="sunken">
          <Eyebrow>{t('safety.disclaimerTitle')}</Eyebrow>
          <Body style={styles.body}>{t('safety.fullNotice')}</Body>

          <View style={styles.list}>
            <Body style={styles.limit}>
              • The freshness score is a transparent heuristic over measured
              image features, not the output of a model trained on spoiled food.
            </Body>
            <Body style={styles.limit}>
              • Shelf-life figures are typical domestic ranges for a sound
              example, scaled by the assessed condition. They are estimates.
            </Body>
            <Body style={styles.limit}>
              • For meat, poultry, seafood and dairy the score is capped, because
              a photograph cannot establish freshness for those foods.
            </Body>
            <Body style={styles.limit}>
              • A printed best-before date always takes priority over anything
              Fresora estimates.
            </Body>
          </View>
        </Card>

        <SafetyNotice text={t('safety.shortNotice')} compact />
      </Gutter>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Caption style={styles.rowLabel}>{label}</Caption>
      <Label style={styles.rowValue} numberOfLines={2}>
        {value}
      </Label>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  brand: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  name: {
    marginTop: spacing.sm,
  },
  body: {
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  list: {
    marginTop: spacing.base,
    gap: spacing.md,
  },
  row: {
    gap: 2,
  },
  rowLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 14.5,
  },
  limit: {
    lineHeight: 21,
  },
});
