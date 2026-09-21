/**
 * Jest setup.
 *
 * Mocks the native modules the units under test import transitively. Each mock
 * is the smallest thing that satisfies the import -- these tests exercise our
 * own logic, not Expo's.
 *
 * These run under `testEnvironment: node` with plain babel-jest, NOT the
 * React Native jest preset: `@react-native/jest-preset` shipped with RN 0.86.3
 * references `react-native/src/setup-env.js`, which does not exist in that
 * release, so the preset cannot load. Nothing under test needs a renderer --
 * the suites cover pure logic (ageing, scoring, analytics, i18n) -- so the
 * preset is not worth patching around.
 *
 * Consequence to be aware of: component render tests are not possible in this
 * configuration. Adding them means getting the RN preset working first.
 */

// `react-native` cannot be imported for real in a node environment. Only two
// of its exports are reachable from the code under test (i18n reads the device
// locale), so those are all that is mocked.
jest.mock('react-native', () => ({
  NativeModules: {
    SettingsManager: { settings: { AppleLocale: 'en_GB', AppleLanguages: ['en-GB'] } },
    I18nManager: { localeIdentifier: 'en_GB' },
  },
  Platform: {
    OS: 'android',
    select: (options) => options.android ?? options.default,
  },
}));

// AsyncStorage: an in-memory map is enough to test the local store for real,
// which is better than mocking our own store away.
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((key) => Promise.resolve(store.has(key) ? store.get(key) : null)),
      setItem: jest.fn((key, value) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      removeItem: jest.fn((key) => {
        store.delete(key);
        return Promise.resolve();
      }),
      multiRemove: jest.fn((keys) => {
        keys.forEach((key) => store.delete(key));
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        store = new Map();
        return Promise.resolve();
      }),
      __reset: () => {
        store = new Map();
      },
    },
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { version: '1.0.0', hostUri: '127.0.0.1:8081' },
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-device', () => ({ isDevice: false }));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
}));

jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///documents/' }, cache: { uri: 'file:///cache/' } },
  File: jest.fn(),
  Directory: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: [] })),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));
