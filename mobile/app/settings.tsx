import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Section } from '../src/components/Card';
import { BottomSheet, SettingGroup, SettingRow } from '../src/components/Controls';
import { Chip } from '../src/components/Button';
import { InfoCard } from '../src/components/FoodCard';
import { Gutter, Screen } from '../src/components/Screen';
import { Body, Eyebrow } from '../src/components/Text';
import { useToast } from '../src/components/Toast';
import { useInventory } from '../src/hooks/useInventory';
import { useTranslation } from '../src/i18n';
import {
  isExpoGo,
  notificationsAvailable,
  requestPermission,
  scheduleReminders,
} from '../src/services/notifications';
import { getStore } from '../src/services/storage';
import { useAppStore, usePreferences } from '../src/store/app';
import { FOOD_CATEGORIES, STORAGE_TYPES, type FoodCategory, type StorageType } from '../src/types';
import { spacing } from '../src/theme';
import { View } from 'react-native';

/**
 * Settings.
 *
 * Toggling notifications on asks for the OS permission first and refuses to
 * flip the switch if permission is denied -- a switch that says "on" while the
 * OS blocks delivery is a lie the user will only discover by missing reminders.
 */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const preferences = usePreferences();
  const patchPreferences = useAppStore((state) => state.patchPreferences);
  const { view } = useInventory();

  const [sheet, setSheet] = useState<'category' | 'storage' | null>(null);

  /** Persists a preference change and reschedules reminders if relevant. */
  const update = async (patch: Partial<typeof preferences>) => {
    patchPreferences(patch);
    const next = await getStore().savePreferences(patch);

    await scheduleReminders(view, {
      enabled: next.notifications_enabled,
      expiryReminders: next.expiry_reminders,
      rescueSuggestions: next.rescue_suggestions,
    });
  };

  const onToggleNotifications = async (enabled: boolean) => {
    if (!enabled) {
      await update({ notifications_enabled: false });
      return;
    }

    const outcome = await requestPermission();

    if (outcome === 'unsupported') {
      // Two different causes, and the user can act on one of them.
      toast.show(
        isExpoGo
          ? 'Reminders need a development build, not Expo Go.'
          : 'Reminders need a physical device.',
        'info',
      );
      return;
    }
    if (outcome === 'denied') {
      toast.show(t('notifications.permissionBody'), 'error');
      return;
    }

    await update({ notifications_enabled: true });
    toast.show(t('notifications.enable'));
  };

  return (
    <Screen showBack title={t('profile.settings')} tabBarPadding={false}>
      <Section title={t('profile.notifications')}>
        {/* Say why the toggles will not work, rather than letting them fail
            silently. Expo Go has no native notification module. */}
        {!notificationsAvailable() ? (
          <InfoCard
            title="Reminders are unavailable in this build"
            body={
              isExpoGo
                ? 'Expo Go cannot schedule notifications. Everything else works — install the standalone APK or a development build to switch reminders on.'
                : 'This build cannot schedule notifications.'
            }
            icon="info"
            tone="sage"
            style={styles.unavailable}
          />
        ) : null}

        <SettingGroup>
          <SettingRow
            label={t('profile.notificationsEnabled')}
            icon="bell"
            toggle={{
              value: preferences.notifications_enabled,
              onChange: onToggleNotifications,
            }}
          />
          <SettingRow
            label={t('profile.expiryReminders')}
            caption={t('notifications.expiryBody')}
            toggle={{
              value: preferences.expiry_reminders,
              onChange: (value) => update({ expiry_reminders: value }),
            }}
          />
          <SettingRow
            label={t('profile.rescueSuggestions')}
            caption={t('notifications.rescueBody')}
            toggle={{
              value: preferences.rescue_suggestions,
              onChange: (value) => update({ rescue_suggestions: value }),
            }}
          />
        </SettingGroup>
      </Section>

      <Section title={t('profile.preferences')}>
        <SettingGroup>
          <SettingRow
            label={t('profile.defaultCategory')}
            value={t(`category.${preferences.default_category}`)}
            icon="filter"
            onPress={() => setSheet('category')}
          />
          <SettingRow
            label={t('profile.defaultStorage')}
            value={t(`storage.${preferences.default_storage}`)}
            icon="fridge"
            onPress={() => setSheet('storage')}
          />
        </SettingGroup>
      </Section>

      <Section>
        <InfoCard
          title={t('profile.aiInformation')}
          body={t('profile.aiInformationBody')}
          icon="info"
          tone="sunken"
        />
      </Section>

      {/* --- Default category picker ---------------------------------- */}
      <BottomSheet
        visible={sheet === 'category'}
        onClose={() => setSheet(null)}
        title={t('profile.defaultCategory')}
      >
        <View style={styles.chips}>
          {(['auto', ...FOOD_CATEGORIES] as Array<FoodCategory | 'auto'>).map((choice) => (
            <Chip
              key={choice}
              label={t(`category.${choice}`)}
              selected={preferences.default_category === choice}
              onPress={() => {
                update({ default_category: choice });
                setSheet(null);
              }}
            />
          ))}
        </View>
      </BottomSheet>

      {/* --- Default storage picker ----------------------------------- */}
      <BottomSheet
        visible={sheet === 'storage'}
        onClose={() => setSheet(null)}
        title={t('profile.defaultStorage')}
      >
        <View style={styles.chips}>
          {STORAGE_TYPES.map((choice: StorageType) => (
            <Chip
              key={choice}
              label={t(`storage.${choice}`)}
              selected={preferences.default_storage === choice}
              onPress={() => {
                update({ default_storage: choice });
                setSheet(null);
              }}
            />
          ))}
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  unavailable: {
    marginBottom: spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
});
