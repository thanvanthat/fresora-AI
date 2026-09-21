/**
 * Regression test for the Expo Go crash.
 *
 * In Expo Go on Android, *importing* `expo-notifications` throws. A top-level
 * import in `notifications.ts` therefore took down every module that imported
 * it -- `app/_layout.tsx` and `app/settings.tsx` -- which expo-router surfaced
 * as "Route is missing the required default export" and then
 * "Cannot read property 'ErrorBoundary' of undefined".
 *
 * These tests pin the contract that prevents it: importing this service must
 * never throw, and every export must degrade to a harmless no-op when the
 * native module cannot be loaded.
 */

const ITEMS = [
  {
    id: 'a',
    food_name: 'Tomato',
    displayStatus: 'nearly_spoiled' as const,
    displayRemaining: 1,
  },
] as never;

const OPTIONS = { enabled: true, expiryReminders: true, rescueSuggestions: true };

describe('when expo-notifications cannot be loaded (Expo Go)', () => {
  beforeEach(() => {
    jest.resetModules();

    // Report Expo Go, which is what makes the module skip the require.
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { executionEnvironment: 'storeClient', expoConfig: { version: '1.0.0' } },
      ExecutionEnvironment: { StoreClient: 'storeClient', Standalone: 'standalone', Bare: 'bare' },
    }));

    // Reproduce the real failure: throwing on module evaluation.
    jest.doMock('expo-notifications', () => {
      throw new Error(
        'expo-notifications: Android Push notifications (remote notifications) ' +
          'functionality provided by expo-notifications was removed from Expo Go ' +
          'with the release of SDK 53.',
      );
    });

    jest.doMock('expo-device', () => ({ isDevice: true }));
  });

  it('imports without throwing', () => {
    // The whole bug in one assertion.
    expect(() => require('./notifications')).not.toThrow();
  });

  it('reports itself unavailable', () => {
    const service = require('./notifications');
    expect(service.isExpoGo).toBe(true);
    expect(service.notificationsAvailable()).toBe(false);
  });

  it('reports permission as unsupported rather than throwing', async () => {
    const service = require('./notifications');
    await expect(service.requestPermission()).resolves.toBe('unsupported');
  });

  it('has no permission', async () => {
    const service = require('./notifications');
    await expect(service.hasPermission()).resolves.toBe(false);
  });

  it('cancelAll is a silent no-op', async () => {
    const service = require('./notifications');
    await expect(service.cancelAll()).resolves.toBeUndefined();
  });

  it('schedules nothing and returns 0', async () => {
    const service = require('./notifications');
    await expect(service.scheduleReminders(ITEMS, OPTIONS)).resolves.toBe(0);
  });

  it('returns a callable no-op unsubscribe', () => {
    const service = require('./notifications');
    const unsubscribe = service.onNotificationTapped(() => undefined);
    expect(typeof unsubscribe).toBe('function');
    // The root layout calls this on unmount; it must not throw.
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('when expo-notifications loads (dev or release build)', () => {
  // Typed with its argument so `mock.calls[0][0]` is accessible below; a
  // zero-arg jest.fn() gives the calls tuple an empty type.
  const scheduleNotificationAsync = jest.fn(
    (_request: { content: { title: string; body: string } }) => Promise.resolve('id'),
  );
  const setNotificationHandler = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    scheduleNotificationAsync.mockClear();
    setNotificationHandler.mockClear();

    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { executionEnvironment: 'standalone', expoConfig: { version: '1.0.0' } },
      ExecutionEnvironment: { StoreClient: 'storeClient', Standalone: 'standalone', Bare: 'bare' },
    }));

    jest.doMock('expo-device', () => ({ isDevice: true }));

    jest.doMock('expo-notifications', () => ({
      setNotificationHandler,
      scheduleNotificationAsync,
      getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
      requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
      cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
      setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
      addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
      AndroidImportance: { DEFAULT: 3 },
      SchedulableTriggerInputTypes: { DAILY: 'daily' },
    }));
  });

  it('reports itself available and installs the foreground handler', () => {
    const service = require('./notifications');
    expect(service.isExpoGo).toBe(false);
    expect(service.notificationsAvailable()).toBe(true);
    expect(setNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it('schedules the urgent-item reminder', async () => {
    const service = require('./notifications');
    const count = await service.scheduleReminders(ITEMS, OPTIONS);

    expect(count).toBe(1);
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // The most urgent item's name must reach the notification title.
    expect(scheduleNotificationAsync.mock.calls[0][0].content.title).toContain('Tomato');
  });

  it('adds the rescue prompt only from three at-risk items', async () => {
    const service = require('./notifications');
    const three = [
      { id: 'a', food_name: 'Tomato', displayStatus: 'nearly_spoiled', displayRemaining: 1 },
      { id: 'b', food_name: 'Spinach', displayStatus: 'nearly_spoiled', displayRemaining: 1 },
      { id: 'c', food_name: 'Banana', displayStatus: 'overripe', displayRemaining: 2 },
    ] as never;

    await expect(service.scheduleReminders(three, OPTIONS)).resolves.toBe(2);
  });

  it('schedules nothing when reminders are switched off', async () => {
    const service = require('./notifications');
    const count = await service.scheduleReminders(ITEMS, { ...OPTIONS, enabled: false });

    expect(count).toBe(0);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules nothing when nothing needs attention', async () => {
    const service = require('./notifications');
    const fresh = [
      { id: 'a', food_name: 'Tomato', displayStatus: 'fresh', displayRemaining: 9 },
    ] as never;

    await expect(service.scheduleReminders(fresh, OPTIONS)).resolves.toBe(0);
  });
});

describe('routeFromNotification', () => {
  beforeEach(() => jest.resetModules());

  it('reads a string route from the payload', () => {
    const { routeFromNotification } = require('./notifications');
    expect(
      routeFromNotification({ request: { content: { data: { route: '/inventory' } } } }),
    ).toBe('/inventory');
  });

  it('returns null for a missing or non-string route', () => {
    const { routeFromNotification } = require('./notifications');
    expect(routeFromNotification({ request: { content: { data: {} } } })).toBeNull();
    expect(routeFromNotification({ request: { content: { data: null } } })).toBeNull();
    expect(
      routeFromNotification({ request: { content: { data: { route: 42 } } } }),
    ).toBeNull();
  });
});
