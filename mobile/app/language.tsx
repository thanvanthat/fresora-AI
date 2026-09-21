import { StyleSheet, View } from 'react-native';

import { Icon } from '../src/components/Icon';
import { Card } from '../src/components/Card';
import { Gutter, Screen } from '../src/components/Screen';
import { SafetyNotice } from '../src/components/States';
import { Body, Caption, Label } from '../src/components/Text';
import { useToast } from '../src/components/Toast';
import { LANGUAGES, useTranslation } from '../src/i18n';
import { getStore } from '../src/services/storage';
import { useAppStore } from '../src/store/app';
import { colors, spacing } from '../src/theme';
import { Pressable } from 'react-native';

/**
 * Language picker.
 *
 * Each language is shown in its own script -- a user looking for Tamil is
 * looking for "தமிழ்", not "Tamil". The choice is persisted so it survives a
 * restart, and applied immediately: `setLanguage` notifies every subscriber, so
 * the whole tree re-renders without a reload.
 */
export default function LanguageScreen() {
  const { t, language, setLanguage } = useTranslation();
  const toast = useToast();
  const patchPreferences = useAppStore((state) => state.patchPreferences);

  const onSelect = async (code: string) => {
    setLanguage(code);
    patchPreferences({ language: code });
    await getStore().savePreferences({ language: code });
    toast.show(t('common.save'));
  };

  return (
    <Screen showBack title={t('profile.language')} tabBarPadding={false}>
      <Gutter style={styles.container}>
        <Card padded={false}>
          {LANGUAGES.map((entry, index) => {
            const selected = entry.code === language;
            return (
              <Pressable
                key={entry.code}
                onPress={() => onSelect(entry.code)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${entry.nativeName} (${entry.englishName})`}
                style={({ pressed }) => [
                  styles.row,
                  index < LANGUAGES.length - 1 ? styles.rowDivider : null,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <View style={styles.rowText}>
                  <Label style={styles.native}>{entry.nativeName}</Label>
                  <Caption>{entry.englishName}</Caption>
                </View>
                {selected ? <Icon name="check" size={19} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </Card>

        <Body style={styles.note}>
          Fresora falls back to English for anything not yet translated, so the
          interface is always complete.
        </Body>

        <SafetyNotice text={t('safety.shortNotice')} compact />
      </Gutter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    minHeight: 64,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  rowText: {
    gap: 2,
  },
  native: {
    fontSize: 17,
  },
  note: {
    lineHeight: 21,
  },
});
