import { Platform, StyleSheet, View } from 'react-native';

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

        {/* --- Technology --------------------------------------------- */}
        {/* Everything that actually ships. The platform row is computed so
            this never claims a capability the current build does not have. */}
        <Card>
          <Eyebrow>{t('profile.technology')}</Eyebrow>
          <Body style={styles.body}>{t('profile.technologyBody')}</Body>

          <View style={styles.list}>
            <Row label="Platform" value={platformSummary()} />
            <Row label="App framework" value="React Native 0.86 · Expo SDK 57" />
            <Row label="Language" value="TypeScript (strict)" />
            <Row label="Navigation" value="expo-router (file-based)" />
            <Row label="Server state" value="TanStack Query" />
            <Row label="Client state" value="Zustand" />
            <Row label="Validation" value="Zod" />
            <Row label="Charts" value="react-native-svg" />
            <Row label="Web target" value="react-native-web" />
            <Row label="API" value="FastAPI · Uvicorn · Pydantic v2" />
            <Row label="Computer vision" value="OpenCV (headless) · NumPy" />
            <Row label="Image classifier" value="MobileNetV2 via onnxruntime" />
            <Row label="Image pipeline" value="expo-image-manipulator · Pillow" />
            <Row label="Database" value="Supabase Postgres + RLS (optional)" />
            <Row label="Hosting" value="Vercel — static web + Python serverless" />
            <Row label="Languages" value="English, Tamil, Hindi, Malayalam, Telugu, Kannada" />
          </View>
        </Card>

        {/* --- Device capabilities ------------------------------------ */}
        <Card tone="sunken">
          <Eyebrow>{t('profile.deviceCapabilities')}</Eyebrow>
          <Body style={styles.body}>{t('profile.deviceCapabilitiesBody')}</Body>

          <View style={styles.list}>
            <Row label="Camera" value={cameraSummary()} />
            <Row label="Photo library" value="expo-image-picker" />
            <Row label="Network status" value="@react-native-community/netinfo" />
            <Row label="Haptics" value={nativeOnly('expo-haptics')} />
            <Row label="Local notifications" value={nativeOnly('expo-notifications')} />
            <Row label="Secure storage" value={nativeOnly('expo-secure-store')} />
            <Row label="File storage" value={nativeOnly('expo-file-system')} />
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

/** Which build the user is actually looking at. */
function platformSummary(): string {
  if (Platform.OS === 'web') return 'Web build (runs in the browser)';
  return `Native ${Platform.OS === 'ios' ? 'iOS' : 'Android'} build`;
}

/**
 * The web build deliberately does not mount a live camera preview: browsers
 * gate getUserMedia inconsistently and a refusal cannot be undone from inside
 * the page, so capture is handed to the device's own camera app instead.
 */
function cameraSummary(): string {
  return Platform.OS === 'web'
    ? 'Device camera via the browser file picker'
    : 'expo-camera live preview (torch, framing guides)';
}

/** Native modules with no browser equivalent degrade rather than fail. */
function nativeOnly(module: string): string {
  return Platform.OS === 'web' ? `${module} — not available on web` : module;
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
