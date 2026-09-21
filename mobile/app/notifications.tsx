import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Icon } from '../src/components/Icon';
import { Gutter, Screen } from '../src/components/Screen';
import { EmptyState, SkeletonList } from '../src/components/States';
import { Body, Caption, Label } from '../src/components/Text';
import { notificationsKey } from '../src/hooks/useInventory';
import { useTranslation } from '../src/i18n';
import { getStore } from '../src/services/storage';
import type { AppNotification } from '../src/types';
import { GUTTER, colors, radius, spacing, statusColors } from '../src/theme';

/**
 * Notification inbox.
 *
 * These are the app's own records of reminders, kept separately from the OS
 * notification tray so the user can see what Fresora has flagged even if
 * they dismissed the system banner.
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: notificationsKey,
    queryFn: () => getStore().listNotifications(),
  });

  const markAllRead = useMutation({
    mutationFn: () => getStore().markAllNotificationsRead(),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationsKey }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => getStore().markNotificationRead(id),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationsKey }),
  });

  const unreadCount = notifications.filter((item) => !item.read).length;

  const toneFor = (type: AppNotification['type']) => {
    switch (type) {
      case 'expiry':
      case 'priority':
        return statusColors.nearly_spoiled;
      case 'rescue':
        return statusColors.fresh;
      default:
        return statusColors.processing;
    }
  };

  return (
    <Screen
      showBack
      title={t('notifications.title')}
      scroll={false}
      tabBarPadding={false}
      headerRight={
        unreadCount > 0 ? (
          <Button
            label={t('notifications.markAllRead')}
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => markAllRead.mutate()}
          />
        ) : undefined
      }
    >
      {isLoading ? (
        <SkeletonList count={3} />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const tone = toneFor(item.type);
            return (
              <Pressable
                onPress={() => {
                  if (!item.read) markRead.mutate(item.id);
                  if (item.action_route) router.push(item.action_route as never);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. ${item.message}`}
                accessibilityState={{ selected: !item.read }}
              >
                <Card style={[styles.card, item.read ? styles.cardRead : null]}>
                  <View style={styles.row}>
                    <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
                      <Icon
                        name={item.type === 'rescue' ? 'chef' : 'clock'}
                        size={17}
                        color={tone.fg}
                      />
                    </View>
                    <View style={styles.text}>
                      <Label numberOfLines={2}>{item.title}</Label>
                      <Body style={styles.message} numberOfLines={3}>
                        {item.message}
                      </Body>
                      <Caption>
                        {new Date(item.created_at).toLocaleDateString()}
                      </Caption>
                    </View>
                    {!item.read ? <View style={styles.unreadDot} /> : null}
                  </View>
                </Card>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="bell"
              title={t('notifications.emptyTitle')}
              body={t('notifications.emptyBody')}
              actionLabel={t('profile.settings')}
              onAction={() => router.push('/settings')}
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: GUTTER,
    paddingBottom: spacing.huge,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardRead: {
    opacity: 0.68,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 3,
  },
  message: {
    lineHeight: 20,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
});
