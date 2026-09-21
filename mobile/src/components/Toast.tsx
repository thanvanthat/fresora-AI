import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GUTTER, colors, palette, radius, shadows, spacing } from '../theme';
import { Icon, type IconName } from './Icon';
import { Body } from './Text';

type ToastTone = 'success' | 'error' | 'info';

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

/** `const toast = useToast(); toast.show('Saved')` from anywhere in the tree. */
export const useToast = (): ToastApi => useContext(ToastContext);

const TONES: Record<ToastTone, { bg: string; fg: string; icon: IconName }> = {
  success: { bg: colors.primaryDark, fg: colors.textOnPrimary, icon: 'check' },
  error: { bg: palette.red600, fg: colors.textOnPrimary, icon: 'alert-triangle' },
  info: { bg: colors.primaryDark, fg: colors.textOnPrimary, icon: 'info' },
};

const VISIBLE_MS = 2600;

/**
 * Toast host. Mounted once at the root so any screen can raise a message
 * without each one owning its own overlay.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;

    Animated.spring(slide, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
    }).start();

    timer.current = setTimeout(() => {
      Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }).start(
        () => setToast(null),
      );
    }, VISIBLE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, slide]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[
            styles.wrap,
            {
              bottom: insets.bottom + 92,
              opacity: slide,
              transform: [
                {
                  translateY: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [24, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.toast, { backgroundColor: TONES[toast.tone].bg }]}>
            <Icon name={TONES[toast.tone].icon} size={17} color={TONES[toast.tone].fg} />
            <Body style={[styles.text, { color: TONES[toast.tone].fg }]}>{toast.message}</Body>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: GUTTER,
    right: GUTTER,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    ...shadows.lg,
  },
  text: {
    flex: 1,
    lineHeight: 20,
  },
});
