import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { Chip, IconButton, SecondaryButton } from '../src/components/Button';
import { Card, Section } from '../src/components/Card';
import { InfoCard } from '../src/components/FoodCard';
import { Gutter, Screen } from '../src/components/Screen';
import { EmptyState, LoadingState } from '../src/components/States';
import { Body, Caption, Label } from '../src/components/Text';
import { useToast } from '../src/components/Toast';
import { useShoppingSuggestions } from '../src/hooks/useAnalytics';
import { useTranslation } from '../src/i18n';
import { getStore } from '../src/services/storage';
import { colors, spacing } from '../src/theme';

/**
 * Smart shopping.
 *
 * Suggestions come only from what the user *consumed* and no longer has --
 * never from what they discarded. Recommending a repurchase of something that
 * was thrown away untouched would encourage exactly the waste this app exists
 * to prevent.
 *
 * "Already in your kitchen" is shown first and deliberately prominent: the most
 * useful thing this screen can do is stop a duplicate purchase.
 */
export default function ShoppingScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useQueryClient();

  const { data, isLoading } = useShoppingSuggestions();

  const saveList = useMutation({
    mutationFn: (items: string[]) => getStore().saveShoppingList(items),
    onSuccess: () => client.invalidateQueries({ queryKey: ['shopping'] }),
  });

  const list = data?.list ?? [];

  const toggle = (name: string) => {
    const next = list.includes(name)
      ? list.filter((entry) => entry !== name)
      : [...list, name];
    saveList.mutate(next);
  };

  const onAdd = (name: string) => {
    // Warn rather than block: the user may genuinely want more of something.
    if (data?.alreadyHave.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      toast.show(t('shopping.duplicateWarning', { food: name }), 'info');
    }
    toggle(name);
  };

  if (isLoading) {
    return (
      <Screen showBack title={t('shopping.title')} tabBarPadding={false}>
        <LoadingState message={t('common.loading')} />
      </Screen>
    );
  }

  const nothingToShow =
    !data ||
    (data.alreadyHave.length === 0 && data.suggested.length === 0 && list.length === 0);

  return (
    <Screen
      showBack
      eyebrow={t('shopping.subtitle')}
      title={t('shopping.title')}
      tabBarPadding={false}
    >
      {nothingToShow ? (
        <EmptyState
          icon="cart"
          title={t('shopping.emptyTitle')}
          body={t('shopping.emptyBody')}
        />
      ) : (
        <>
          {/* --- The list ---------------------------------------------- */}
          {list.length > 0 ? (
            <Section title={t('shopping.onList')}>
              <Card>
                {list.map((name) => (
                  <View key={name} style={styles.listRow}>
                    <Body style={styles.listName}>{name}</Body>
                    <IconButton
                      icon="close"
                      onPress={() => toggle(name)}
                      accessibilityLabel={t('common.remove')}
                      size={17}
                    />
                  </View>
                ))}
              </Card>
              <SecondaryButton
                label={t('shopping.clearList')}
                icon="trash"
                onPress={() => saveList.mutate([])}
                style={styles.clear}
              />
            </Section>
          ) : null}

          {/* --- Suggestions ------------------------------------------- */}
          {data.suggested.length > 0 ? (
            <Section title={t('shopping.suggested')}>
              <Caption style={styles.sectionBody}>{t('shopping.suggestedBody')}</Caption>
              <View style={styles.chips}>
                {data.suggested.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    icon={list.includes(name) ? 'check' : 'plus'}
                    selected={list.includes(name)}
                    onPress={() => onAdd(name)}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          {/* --- Running low ------------------------------------------- */}
          {data.runningLow.length > 0 ? (
            <Section title={t('shopping.runningLow')}>
              <View style={styles.chips}>
                {data.runningLow.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    icon={list.includes(name) ? 'check' : 'plus'}
                    selected={list.includes(name)}
                    onPress={() => onAdd(name)}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          {/* --- Already have: the anti-duplicate section -------------- */}
          {data.alreadyHave.length > 0 ? (
            <Section title={t('shopping.alreadyHave')}>
              <InfoCard
                title={t('shopping.alreadyHave')}
                body={data.alreadyHave.join(' · ')}
                icon="check"
                tone="sage"
              />
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionBody: {
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  listName: {
    color: colors.textPrimary,
    flex: 1,
  },
  clear: {
    marginTop: spacing.md,
  },
});
