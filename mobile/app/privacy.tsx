import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { Card, Section } from '../src/components/Card';
import { ConfirmModal, SettingGroup, SettingRow } from '../src/components/Controls';
import { Gutter, Screen } from '../src/components/Screen';
import { Body, Caption, Eyebrow } from '../src/components/Text';
import { useToast } from '../src/components/Toast';
import { SUPABASE_CONFIGURED } from '../src/constants/config';
import { useClearScans } from '../src/hooks/useScans';
import { useTranslation } from '../src/i18n';
import { deleteAllStoredImages } from '../src/services/image';
import { colors, spacing } from '../src/theme';

/**
 * Privacy.
 *
 * Describes what actually happens to a photo, in concrete terms. Written from
 * the code, not from a template: images are uploaded for analysis and not
 * persisted server-side, and everything else stays on the device unless a
 * Supabase project is configured.
 */
export default function PrivacyScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useQueryClient();
  const clearScans = useClearScans();

  const [confirmClear, setConfirmClear] = useState(false);

  const onClearHistory = async () => {
    setConfirmClear(false);
    await clearScans.mutateAsync();
    await deleteAllStoredImages();
    client.invalidateQueries();
    toast.show(t('profile.clearHistory'));
  };

  return (
    <Screen showBack title={t('profile.privacy')} tabBarPadding={false}>
      <Gutter style={styles.container}>
        <Card>
          <Eyebrow>{t('profile.privacyPolicy')}</Eyebrow>

          <Body style={styles.paragraph}>
            <Body style={styles.term}>Photos. </Body>
            When you scan food, the image is compressed on your device and sent
            to the Fresora analysis server so it can be measured. The server
            analyses it in memory and does not store it. The copy kept for your
            inventory and history stays in this app&apos;s private storage on
            your device.
          </Body>

          <Body style={styles.paragraph}>
            <Body style={styles.term}>Your food data. </Body>
            {SUPABASE_CONFIGURED
              ? 'Your inventory, scans and recipes are stored in your account and protected by row-level security, so only you can read them.'
              : 'Your inventory, scans and recipes are stored only on this device. Nothing is uploaded and no account exists.'}
          </Body>

          <Body style={styles.paragraph}>
            <Body style={styles.term}>The AI assistant. </Body>
            When you ask a question, the question, the food you are viewing and a
            short list of your inventory item names are sent to the server so the
            answer can be relevant. Your photos are never sent to the assistant.
          </Body>

          <Body style={styles.paragraph}>
            <Body style={styles.term}>Analytics. </Body>
            Every figure on the Analytics screen is calculated on your device
            from your own rows. Nothing is reported to us.
          </Body>

          <Body style={styles.paragraph}>
            <Body style={styles.term}>Notifications. </Body>
            Reminders are scheduled locally by the app. No server is involved and
            no device token is collected.
          </Body>
        </Card>

        <Section title={t('profile.data')}>
          <SettingGroup>
            <SettingRow
              label={t('profile.clearHistory')}
              caption={t('profile.clearHistoryBody')}
              icon="trash"
              onPress={() => setConfirmClear(true)}
            />
          </SettingGroup>
          <Caption style={styles.note}>
            To remove everything including your inventory, use &ldquo;
            {t('profile.deleteAccount')}&rdquo; on the You tab.
          </Caption>
        </Section>
      </Gutter>

      <ConfirmModal
        visible={confirmClear}
        title={t('profile.clearHistory')}
        body={t('profile.clearHistoryBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onClearHistory}
        onCancel={() => setConfirmClear(false)}
        destructive
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  paragraph: {
    marginTop: spacing.base,
    lineHeight: 22,
  },
  term: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  note: {
    marginTop: spacing.md,
    lineHeight: 18,
  },
});
