import { useRouter } from 'expo-router';
import { useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';

import { IconButton } from '../src/components/Button';
import { ConfirmModal, Field } from '../src/components/Controls';
import { FoodCard } from '../src/components/FoodCard';
import { Gutter, Screen } from '../src/components/Screen';
import { EmptyState, SkeletonList } from '../src/components/States';
import { Eyebrow } from '../src/components/Text';
import { useToast } from '../src/components/Toast';
import { useDeleteScan, useGroupedScans } from '../src/hooks/useScans';
import { useTranslation } from '../src/i18n';
import type { FoodScan } from '../src/types';
import { GUTTER, palette, spacing } from '../src/theme';

/**
 * Scan history, grouped into Today / Yesterday / date.
 *
 * SectionList rather than a mapped ScrollView: history grows without bound and
 * the sticky section headers are what make a long list navigable.
 */
export default function HistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<FoodScan | null>(null);

  const { groups, isLoading, refetch, isRefetching } = useGroupedScans(search);
  const deleteScan = useDeleteScan();

  const sections = groups.map((group) => ({
    title:
      group.kind === 'today'
        ? t('common.today')
        : group.kind === 'yesterday'
          ? t('common.yesterday')
          : group.date.toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
            }),
    data: group.items,
  }));

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    const scan = pendingDelete;
    setPendingDelete(null);

    deleteScan.mutate(scan, {
      onSuccess: () => toast.show(t('inventory.removedToast', { food: scan.food_name })),
    });
  };

  return (
    <Screen showBack title={t('history.title')} scroll={false} tabBarPadding={false}>
      <Gutter style={styles.searchWrap}>
        <Field
          label={t('common.search')}
          value={search}
          onChangeText={setSearch}
          placeholder={t('history.searchPlaceholder')}
          autoCapitalize="none"
        />
      </Gutter>

      {isLoading ? (
        <SkeletonList count={4} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(scan) => scan.id}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Eyebrow>{section.title}</Eyebrow>
            </View>
          )}
          renderItem={({ item }) => (
            <FoodCard
              foodName={item.food_name}
              status={item.status}
              category={item.category}
              imageUri={item.image_uri}
              score={item.score}
              detail={new Date(item.scanned_at).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}
              onPress={
                item.inventory_item_id
                  ? () => router.push(`/item/${item.inventory_item_id}`)
                  : undefined
              }
              trailing={
                <IconButton
                  icon="trash"
                  onPress={() => setPendingDelete(item)}
                  accessibilityLabel={t('common.delete')}
                  size={18}
                />
              }
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="history"
              title={search ? t('history.noResults', { query: search }) : t('history.emptyTitle')}
              body={search ? undefined : t('history.emptyBody')}
              actionLabel={search ? undefined : t('home.scanFood')}
              onAction={search ? undefined : () => router.replace('/scan')}
            />
          }
        />
      )}

      <ConfirmModal
        visible={pendingDelete !== null}
        title={t('history.deleteConfirm')}
        body={t('history.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onConfirmDelete}
        onCancel={() => setPendingDelete(null)}
        destructive
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    marginBottom: spacing.lg,
  },
  list: {
    paddingHorizontal: GUTTER,
    paddingBottom: spacing.huge,
  },
  sectionHeader: {
    paddingVertical: spacing.md,
    backgroundColor: palette.cream50,
  },
});
