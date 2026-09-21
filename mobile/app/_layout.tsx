import NetInfo from '@react-native-community/netinfo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '../src/components/Toast';
import { detectDeviceLanguage, setLanguage } from '../src/i18n';
import { getHealth } from '../src/services/api/endpoints';
import { getCurrentUser, onAuthChange } from '../src/services/auth';
import { onNotificationTapped } from '../src/services/notifications';
import { getStore, setSignedIn } from '../src/services/storage';
import { useAppStore } from '../src/store/app';
import { colors } from '../src/theme';
import { ApiError } from '../src/services/api/client';

/**
 * Root layout: providers, bootstrap, and the navigation stack.
 *
 * The splash screen is held until `ready` so the first frame the user sees is
 * the right one -- without this they get a flash of Home before being bounced
 * to onboarding.
 */

// Errors are surfaced per-screen through ErrorState, so no global retry storm.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Offline or a missing model will not fix itself by retrying.
        if (error instanceof ApiError) {
          if (error.code === 'network' || error.code === 'model_unavailable') return false;
        }
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden, or unsupported on this platform. Not worth failing over.
});

export default function RootLayout() {
  const router = useRouter();
  const ready = useAppStore((state) => state.ready);
  const setReady = useAppStore((state) => state.setReady);
  const setSession = useAppStore((state) => state.setSession);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const setOnboarded = useAppStore((state) => state.setOnboarded);
  const setOnline = useAppStore((state) => state.setOnline);
  const setCapabilities = useAppStore((state) => state.setCapabilities);

  // --- Bootstrap ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // 1. Session first: it decides which store the rest of this reads from.
      const user = await getCurrentUser();
      if (cancelled) return;
      setSignedIn(Boolean(user));

      const store = getStore();
      const [preferences, profile] = await Promise.all([
        store.getPreferences(),
        store.getProfile(),
      ]);
      if (cancelled) return;

      // 2. Language: a saved preference wins, otherwise follow the device.
      setLanguage(preferences.language || detectDeviceLanguage());
      setPreferences(preferences);
      setSession(user?.id ?? null, profile);

      // Onboarding is considered done once anything exists on the device.
      const [inventory, scans] = await Promise.all([
        store.listInventory(),
        store.listScans(),
      ]);
      if (cancelled) return;
      setOnboarded(inventory.length > 0 || scans.length > 0 || Boolean(profile));

      setReady(true);
    }

    bootstrap().catch(() => {
      // Never leave the user on a splash screen. A failed bootstrap still
      // lets them into the app, where individual screens show their own state.
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [setReady, setSession, setPreferences, setOnboarded]);

  // --- Connectivity ---------------------------------------------------
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected));
    });
    return unsubscribe;
  }, [setOnline]);

  // --- Backend capability probe ---------------------------------------
  useEffect(() => {
    let cancelled = false;

    getHealth()
      .then((health) => {
        if (cancelled) return;
        // Record what the backend can actually do, so the UI can hide the
        // Ask AI entry point rather than offering a button that always fails.
        setCapabilities({
          reachable: true,
          classifierAvailable: health.classifier_available,
          llmConfigured: health.llm_configured,
        });
      })
      .catch(() => {
        if (!cancelled) setCapabilities({ reachable: false });
      });

    return () => {
      cancelled = true;
    };
  }, [setCapabilities]);

  // --- Auth changes ---------------------------------------------------
  useEffect(
    () =>
      onAuthChange((user) => {
        setSignedIn(Boolean(user));
        setSession(user?.id ?? null, null);
      }),
    [setSession],
  );

  // --- Notification taps ----------------------------------------------
  useEffect(
    () =>
      onNotificationTapped((route) => {
        // Cast: these routes are ours, written in notifications.ts.
        router.push(route as never);
      }),
    [router],
  );

  // --- Hide the splash once we know where to send the user -------------
  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
              <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
              <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
              {/* Analysis arrives from the scanner, so it rises from below. */}
              <Stack.Screen name="analysis" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="assistant" options={{ presentation: 'modal' }} />
              <Stack.Screen name="add-food" options={{ presentation: 'modal' }} />
            </Stack>
          </ToastProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
