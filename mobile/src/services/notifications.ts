import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { t } from '../i18n';
import { colors } from '../theme';
import type { InventoryView } from '../utils/inventory';

/**
 * Local notifications: freshness reminders and rescue prompts.
 *
 * Local only -- Fresora has no server pushing to devices, and local scheduling
 * is all this feature needs.
 *
 * WHY expo-notifications IS LOADED LAZILY
 * ---------------------------------------
 * In Expo Go on Android, **importing** `expo-notifications` throws:
 *
 *   "Android Push notifications (remote notifications) functionality provided
 *    by expo-notifications was removed from Expo Go with the release of
 *    SDK 53. Use a development build instead of Expo Go."
 *
 * It is the module evaluation that throws, not any call -- so a top-level
 * `import * as Notifications from 'expo-notifications'` here took down every
 * file that imported this one. `app/_layout.tsx` and `app/settings.tsx` both
 * do, so their module exports came back undefined, which expo-router reported
 * as "Route is missing the required default export" and then
 * "Cannot read property 'ErrorBoundary' of undefined". One bad import, seven
 * error screens.
 *
 * So the module is `require`d on demand, inside a try/catch, and every export
 * here degrades to a no-op when it is unavailable. In Expo Go the app runs
 * fine with reminders switched off; in a development or release build they
 * work normally.
 *
 * Nothing schedules anything unless the user enabled reminders in settings AND
 * granted the OS permission. Both are checked every time.
 */

/** Android channel id. Android 8+ requires a channel or nothing is shown. */
const CHANNEL_ID = 'freshness-reminders';

/** Local hour reminders fire at. Morning, when people plan meals. */
const REMINDER_HOUR = 9;
const REMINDER_MINUTE = 0;

type NotificationsModule = typeof import('expo-notifications');

/** True in Expo Go, where the native notification module is absent. */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Cached module, or `null` once we know it cannot be loaded.
 * `undefined` means "not tried yet".
 */
let cached: NotificationsModule | null | undefined;
let handlerInstalled = false;

/**
 * Loads expo-notifications, or returns null if it is unavailable.
 *
 * The require is wrapped because in Expo Go it throws on evaluation. Resolving
 * to null once and caching it means we do not retry (and re-throw) per call.
 */
function loadNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;

  if (isExpoGo) {
    // Skip the require entirely: in Expo Go it is guaranteed to throw.
    cached = null;
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be lazy; see above
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
    return null;
  }

  installHandler(cached);
  return cached;
}

/**
 * Foreground presentation, installed once on first successful load.
 *
 * `shouldShowBanner` / `shouldShowList` are the SDK 57 fields; the older
 * `shouldShowAlert` is deprecated.
 */
function installHandler(notifications: NotificationsModule): void {
  if (handlerInstalled) return;
  handlerInstalled = true;

  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Whether reminders can work at all in this build. Drives the settings UI. */
export function notificationsAvailable(): boolean {
  return loadNotifications() !== null;
}

export type PermissionOutcome = 'granted' | 'denied' | 'unsupported';

/**
 * Asks for notification permission.
 *
 * Returns 'unsupported' on a simulator, and in Expo Go, rather than letting the
 * settings toggle look broken.
 */
export async function requestPermission(): Promise<PermissionOutcome> {
  const notifications = loadNotifications();
  if (!notifications || !Device.isDevice) return 'unsupported';

  if (Platform.OS === 'android') {
    await notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Freshness reminders',
      importance: notifications.AndroidImportance.DEFAULT,
      lightColor: colors.primary,
      vibrationPattern: [0, 250],
    });
  }

  const existing = await notifications.getPermissionsAsync();
  if (existing.granted) return 'granted';

  const requested = await notifications.requestPermissionsAsync();
  return requested.granted ? 'granted' : 'denied';
}

export async function hasPermission(): Promise<boolean> {
  const notifications = loadNotifications();
  if (!notifications || !Device.isDevice) return false;

  const status = await notifications.getPermissionsAsync();
  return status.granted;
}

/** Clears every pending reminder. Called before rescheduling and on opt-out. */
export async function cancelAll(): Promise<void> {
  const notifications = loadNotifications();
  if (!notifications) return;

  await notifications.cancelAllScheduledNotificationsAsync();
}

interface ScheduleOptions {
  enabled: boolean;
  expiryReminders: boolean;
  rescueSuggestions: boolean;
}

/**
 * Rebuilds the reminder schedule from the current inventory.
 *
 * Always cancels first, so this is idempotent: calling it after every
 * inventory change cannot pile up duplicate reminders.
 *
 * Deliberately restrained -- at most two notifications a day:
 *
 * 1. the single most urgent item, if anything needs attention
 * 2. one rescue prompt, if three or more items could go into a recipe
 *
 * Notifying per item would mean eight notifications from one shopping trip,
 * which trains people to swipe them away.
 *
 * Returns the number scheduled: 0 when unavailable, disabled or unpermitted.
 */
export async function scheduleReminders(
  items: InventoryView[],
  options: ScheduleOptions,
): Promise<number> {
  const notifications = loadNotifications();
  if (!notifications) return 0;

  await cancelAll();

  if (!options.enabled || !(await hasPermission())) return 0;

  const attention = items.filter(
    (item) => item.displayStatus === 'nearly_spoiled' || item.displayStatus === 'overripe',
  );
  if (attention.length === 0) return 0;

  let scheduled = 0;
  const trigger = {
    type: notifications.SchedulableTriggerInputTypes.DAILY,
    hour: REMINDER_HOUR,
    minute: REMINDER_MINUTE,
    ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
  } as const;

  if (options.expiryReminders) {
    // `items` arrives sorted by consume priority, so [0] is the most urgent.
    const urgent = attention[0];
    await notifications.scheduleNotificationAsync({
      content: {
        title: t('notifications.priorityTitle', { food: urgent.food_name }),
        body: t('notifications.priorityBody'),
        data: { route: '/inventory' },
      },
      trigger,
    });
    scheduled += 1;
  }

  if (options.rescueSuggestions && attention.length >= 3) {
    await notifications.scheduleNotificationAsync({
      content: {
        title: t('notifications.rescueTitle', { count: attention.length }),
        body: t('notifications.rescueBody'),
        data: { route: '/recipes' },
      },
      trigger,
    });
    scheduled += 1;
  }

  return scheduled;
}

/** Deep-link route carried by a notification, if any. */
export function routeFromNotification(notification: {
  request: { content: { data?: Record<string, unknown> | null } };
}): string | null {
  const route = notification.request.content.data?.route;
  return typeof route === 'string' ? route : null;
}

/**
 * Subscribes to notification taps. Returns an unsubscribe function.
 *
 * Returns a no-op unsubscribe when notifications are unavailable, so callers
 * (the root layout) need no conditional of their own.
 */
export function onNotificationTapped(listener: (route: string) => void): () => void {
  const notifications = loadNotifications();
  if (!notifications) return () => undefined;

  const subscription = notifications.addNotificationResponseReceivedListener(
    (response) => {
      const route = routeFromNotification(response.notification);
      if (route) listener(route);
    },
  );
  return () => subscription.remove();
}
