import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Pill } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card, Section } from '../../src/components/Card';
import { ConfirmModal, SettingGroup, SettingRow } from '../../src/components/Controls';
import { Gutter, Screen } from '../../src/components/Screen';
import { SafetyNotice } from '../../src/components/States';
import { Body, Caption, Label, Title } from '../../src/components/Text';
import { useToast } from '../../src/components/Toast';
import { APP_VERSION, SUPABASE_CONFIGURED } from '../../src/constants/config';
import { LANGUAGES, useTranslation } from '../../src/i18n';
import { authMode, signOut } from '../../src/services/auth';
import { getStore } from '../../src/services/storage';
import { useAppStore, useCapabilities } from '../../src/store/app';
import { colors, radius, spacing } from '../../src/theme';

/**
 * You.
 *
 * Profile, every secondary destination, and the honest status of the backend.
 * The capability rows are not decoration: if the classifier or the AI provider
 * is unavailable, this is where the user finds out why a feature is limited
 * rather than guessing.
 */
export default function YouScreen() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const toast = useToast();

  const profile = useAppStore((state) => state.profile);
  const userId = useAppStore((state) => state.userId);
  const reset = useAppStore((state) => state.reset);
  const capabilities = useCapabilities();

  const [confirmDelete, setConfirmDelete] = useState(false);

  const currentLanguage =
    LANGUAGES.find((entry) => entry.code === language)?.nativeName ?? language;

  const onSignOut = async () => {
    await signOut();
    reset();
    toast.show(t('auth.signOut'));
  };

  const onDeleteEverything = async () => {
    setConfirmDelete(false);
    await getStore().clearAll();
    reset();
    toast.show(t('profile.deleteAccount'));
    router.replace('/');
  };

  return (
    <Screen title={t('profile.title')}>
      {/* --- Identity -------------------------------------------------- */}
      <Gutter>
        <Card style={styles.identity}>
          <View style={styles.avatar}>
            <Title color={colors.primary}>
              {(profile?.full_name ?? profile?.email ?? 'F').charAt(0).toUpperCase()}
            </Title>
          </View>
          <View style={styles.identityText}>
            <Label style={styles.name}>
              {profile?.full_name ?? t('profile.localOnlyAccount')}
            </Label>
            <Caption>{profile?.email ?? t('profile.localOnlyBody')}</Caption>
          </View>
        </Card>
      </Gutter>

      {/* --- Destinations ---------------------------------------------- */}
      <Section title={t('profile.data')}>
        <SettingGroup>
          <SettingRow
            label={t('profile.history')}
            icon="history"
            onPress={() => router.push('/history')}
          />
          <SettingRow
            label={t('profile.analytics')}
            icon="chart"
            onPress={() => router.push('/analytics')}
          />
          <SettingRow
            label={t('profile.shopping')}
            icon="cart"
            onPress={() => router.push('/shopping')}
          />
          <SettingRow
            label={t('profile.notifications')}
            icon="bell"
            onPress={() => router.push('/notifications')}
          />
        </SettingGroup>
      </Section>

      {/* --- Preferences ----------------------------------------------- */}
      <Section title={t('profile.preferences')}>
        <SettingGroup>
          <SettingRow
            label={t('profile.language')}
            value={currentLanguage}
            icon="globe"
            onPress={() => router.push('/language')}
          />
          <SettingRow
            label={t('profile.settings')}
            icon="settings"
            onPress={() => router.push('/settings')}
          />
        </SettingGroup>
      </Section>

      {/* --- Backend status -------------------------------------------- */}
      <Section title="AI STATUS">
        <Card style={styles.status}>
          <View style={styles.statusRow}>
            <Body style={styles.statusLabel}>Analysis server</Body>
            <Pill
              label={
                capabilities.reachable === null
                  ? t('common.loading')
                  : capabilities.reachable
                    ? 'Connected'
                    : 'Unreachable'
              }
              tone={capabilities.reachable ? 'sage' : 'warning'}
              icon={capabilities.reachable ? 'check' : 'alert-triangle'}
            />
          </View>
          <View style={styles.statusRow}>
            <Body style={styles.statusLabel}>Food identification</Body>
            <Pill
              label={capabilities.classifierAvailable ? 'Available' : 'Name food manually'}
              tone={capabilities.classifierAvailable ? 'sage' : 'neutral'}
            />
          </View>
          <View style={styles.statusRow}>
            <Body style={styles.statusLabel}>AI assistant</Body>
            <Pill
              label={capabilities.llmConfigured ? 'Available' : 'Knowledge base only'}
              tone={capabilities.llmConfigured ? 'sage' : 'neutral'}
            />
          </View>
          <Caption style={styles.statusNote}>{t('profile.aiInformationBody')}</Caption>
        </Card>
      </Section>

      {/* --- Account --------------------------------------------------- */}
      <Section title={t('profile.account')}>
        <SettingGroup>
          <SettingRow
            label={t('profile.privacy')}
            icon="lock"
            onPress={() => router.push('/privacy')}
          />
          <SettingRow
            label={t('profile.about')}
            icon="info"
            onPress={() => router.push('/about')}
            caption={`${t('profile.version')} ${APP_VERSION}`}
          />
          {SUPABASE_CONFIGURED && !userId ? (
            <SettingRow
              label={t('auth.signIn')}
              icon="log-out"
              onPress={() => router.push('/(auth)/welcome')}
            />
          ) : null}
          {userId ? (
            <SettingRow label={t('auth.signOut')} icon="log-out" onPress={onSignOut} />
          ) : null}
          <SettingRow
            label={t('profile.deleteAccount')}
            caption={t('profile.deleteAccountBody')}
            icon="trash"
            destructive
            onPress={() => setConfirmDelete(true)}
          />
        </SettingGroup>
      </Section>

      <Gutter>
        <SafetyNotice text={t('safety.fullNotice')} />
        <Caption align="center" style={styles.footer}>
          {t('common.appName')} {APP_VERSION} · {authMode === 'local' ? 'On-device' : 'Synced'}
        </Caption>
      </Gutter>

      <ConfirmModal
        visible={confirmDelete}
        title={t('profile.deleteAccountConfirm')}
        body={t('profile.deleteAccountConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onDeleteEverything}
        onCancel={() => setConfirmDelete(false)}
        destructive
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 17,
  },
  status: {
    gap: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusLabel: {
    flex: 1,
    color: colors.textPrimary,
  },
  statusNote: {
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  footer: {
    marginTop: spacing.lg,
  },
});
