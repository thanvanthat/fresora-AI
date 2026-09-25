import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, IconButton } from '../../src/components/Button';
import { Icon } from '../../src/components/Icon';
import { Body, Caption, Label, Title } from '../../src/components/Text';
import { ErrorState } from '../../src/components/States';
import { useToast } from '../../src/components/Toast';
import { captureFromCamera, pickFromGallery } from '../../src/services/image';
import { useAppStore } from '../../src/store/app';
import { useTranslation } from '../../src/i18n';
import { FOOD_CATEGORIES, type FoodCategory } from '../../src/types';
import { GUTTER, colors, palette, radius, spacing } from '../../src/theme';

/**
 * Scanner.
 *
 * The camera preview is mounted **only while this tab is focused**. expo-camera
 * allows one active preview at a time, and leaving it mounted behind other tabs
 * holds the hardware open, drains battery, and breaks the preview when you
 * return. `useIsFocused` gates it.
 *
 * Capture does not analyse here: the image is handed to the analysis route,
 * which owns the progress UI and the retry path.
 */

type CategoryChoice = FoodCategory | 'auto';

const CATEGORY_CHOICES: CategoryChoice[] = ['auto', ...FOOD_CATEGORIES];

export default function ScanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const isFocused = useIsFocused();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [torch, setTorch] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [category, setCategory] = useState<CategoryChoice>('auto');

  const setPendingScan = useAppStore((state) => state.setPendingScan);

  /** Hands an image to the analysis route. */
  const startAnalysis = useCallback(
    (uri: string) => {
      setPendingScan({
        imageUri: uri,
        categoryHint: category === 'auto' ? undefined : category,
      });
      router.push('/analysis');
    },
    [category, router, setPendingScan],
  );

  const onCapture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;

    setCapturing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

      const photo = await cameraRef.current.takePictureAsync({
        // The backend downscales anyway, and a smaller capture is much faster
        // to compress and upload.
        quality: 0.85,
        skipProcessing: Platform.OS === 'android',
      });

      if (photo?.uri) startAnalysis(photo.uri);
    } catch {
      toast.show(t('errors.imageBody'), 'error');
    } finally {
      setCapturing(false);
    }
  }, [capturing, startAnalysis, t, toast]);

  const onPickGallery = useCallback(async () => {
    const result = await pickFromGallery();

    if (result.permissionDenied) {
      toast.show(t('errors.galleryPermissionBody'), 'error');
      return;
    }
    if (result.cancelled) return;

    startAnalysis(result.uri);
  }, [startAnalysis, t, toast]);

  const onCaptureWeb = useCallback(async () => {
    const result = await captureFromCamera();

    if (result.permissionDenied) {
      toast.show(t('scanner.permissionDeniedBody'), 'error');
      return;
    }
    if (result.cancelled) return;

    startAnalysis(result.uri);
  }, [startAnalysis, t, toast]);

  // --- Web capture ------------------------------------------------------
  // A live CameraView preview needs getUserMedia, which mobile browsers gate
  // inconsistently, and a refused permission cannot be recovered in a browser
  // because Linking.openSettings() has no settings screen to open. Handing off
  // to the phone's own camera app avoids both problems, so the web build never
  // mounts the preview at all.
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.permissionWrap, { paddingTop: insets.top + spacing.xxl }]}>
        <View style={styles.permissionIcon}>
          <Icon name="camera" size={30} color={colors.primary} />
        </View>
        <Title align="center" heading>
          {t('scanner.title')}
        </Title>
        <Body align="center" style={styles.permissionBody}>
          {t('scanner.webCaptureBody')}
        </Body>

        <View style={styles.permissionActions}>
          <Button label={t('scanner.takePhoto')} icon="camera" onPress={onCaptureWeb} />
          <Button
            label={t('scanner.gallery')}
            icon="gallery"
            variant="secondary"
            onPress={onPickGallery}
          />
        </View>
      </View>
    );
  }

  // --- Permission states ----------------------------------------------
  if (!permission) {
    // Still resolving on first mount.
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    const permanentlyDenied = !permission.canAskAgain;

    return (
      <View style={[styles.permissionWrap, { paddingTop: insets.top + spacing.xxl }]}>
        <View style={styles.permissionIcon}>
          <Icon name="camera" size={30} color={colors.primary} />
        </View>
        <Title align="center" heading>
          {t('scanner.permissionTitle')}
        </Title>
        <Body align="center" style={styles.permissionBody}>
          {permanentlyDenied
            ? t('scanner.permissionDeniedBody')
            : t('scanner.permissionBody')}
        </Body>

        <View style={styles.permissionActions}>
          {permanentlyDenied ? (
            <Button
              label={t('scanner.openSettings')}
              icon="settings"
              onPress={() => Linking.openSettings()}
            />
          ) : (
            <Button
              label={t('scanner.permissionCta')}
              icon="camera"
              onPress={requestPermission}
            />
          )}
          {/* Always offer the gallery: it needs no camera permission. */}
          <Button
            label={t('scanner.gallery')}
            icon="gallery"
            variant="secondary"
            onPress={onPickGallery}
          />
        </View>
      </View>
    );
  }

  // --- Camera ---------------------------------------------------------
  return (
    <View style={styles.container}>
      {isFocused ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          // Analysis needs the whole item in frame, so the widest ratio that
          // matches the viewfinder is the right default.
          animateShutter={false}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cameraPlaceholder]} />
      )}

      {/* --- Top bar ------------------------------------------------- */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Label style={styles.topTitle}>{t('scanner.title')}</Label>
        <View style={styles.topActions}>
          <IconButton
            icon={torch ? 'flash' : 'flash-off'}
            onPress={() => setTorch((prior) => !prior)}
            accessibilityLabel={t('scanner.flash')}
            color={torch ? palette.amber500 : colors.textOnPrimary}
            background={colors.cameraGlass}
          />
          <IconButton
            icon="history"
            onPress={() => router.push('/history')}
            accessibilityLabel={t('scanner.history')}
            color={colors.textOnPrimary}
            background={colors.cameraGlass}
          />
        </View>
      </View>

      {/* --- Framing guide ------------------------------------------- */}
      <View style={styles.frameWrap} pointerEvents="none">
        <View style={styles.frame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <Label style={styles.prompt}>{t('scanner.prompt')}</Label>
        <Caption style={styles.hint}>{t('scanner.hint')}</Caption>
      </View>

      {/* --- Category selector --------------------------------------- */}
      <View style={styles.categoryRow}>
        <Pressable
          style={styles.categoryScroll}
          // A horizontal ScrollView inside a camera overlay swallows the
          // shutter's touch area on Android, so the choices are a wrapped row.
        >
          <View style={styles.categoryChips}>
            {CATEGORY_CHOICES.slice(0, 5).map((choice) => (
              <Chip
                key={choice}
                label={t(`category.${choice}`)}
                selected={category === choice}
                onPress={() => setCategory(choice)}
                style={styles.categoryChip}
              />
            ))}
          </View>
        </Pressable>
      </View>

      {/* --- Controls ------------------------------------------------ */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 84 }]}>
        <IconButton
          icon="gallery"
          onPress={onPickGallery}
          accessibilityLabel={t('scanner.gallery')}
          color={colors.textOnPrimary}
          background={colors.cameraGlass}
          size={24}
        />

        <Pressable
          onPress={onCapture}
          disabled={capturing}
          accessibilityRole="button"
          accessibilityLabel={t('scanner.capture')}
          accessibilityState={{ disabled: capturing, busy: capturing }}
          style={({ pressed }) => [
            styles.shutter,
            pressed ? styles.shutterPressed : null,
            capturing ? styles.shutterBusy : null,
          ]}
        >
          {capturing ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.shutterInner} />
          )}
        </Pressable>

        {/* Balances the row so the shutter stays centred. */}
        <View style={styles.controlSpacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cameraBackdrop,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  cameraPlaceholder: {
    backgroundColor: colors.primaryDark,
  },
  permissionWrap: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: GUTTER,
    alignItems: 'center',
    gap: spacing.md,
  },
  permissionIcon: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  permissionBody: {
    maxWidth: 320,
    lineHeight: 23,
  },
  permissionActions: {
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
    paddingBottom: spacing.sm,
  },
  topTitle: {
    color: colors.textOnPrimary,
    fontSize: 17,
  },
  topActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  frameWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.base,
  },
  frame: {
    width: '78%',
    aspectRatio: 1,
    maxWidth: 340,
  },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: colors.onCamera,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.md },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.md },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.md },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.md },
  prompt: {
    color: colors.textOnPrimary,
    fontSize: 16,
    marginTop: spacing.lg,
    textShadowColor: colors.cameraTextShadow,
    textShadowRadius: 6,
  },
  hint: {
    color: colors.onCameraMuted,
    maxWidth: 260,
    textAlign: 'center',
    textShadowColor: colors.cameraTextShadow,
    textShadowRadius: 6,
  },
  categoryRow: {
    paddingHorizontal: GUTTER,
  },
  categoryScroll: {
    alignItems: 'center',
  },
  categoryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  categoryChip: {
    backgroundColor: colors.onCamera,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
  },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: radius.pill,
    backgroundColor: colors.onCameraFaint,
    borderWidth: 4,
    borderColor: colors.textOnPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: {
    transform: [{ scale: 0.94 }],
  },
  shutterBusy: {
    backgroundColor: colors.onCamera,
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    backgroundColor: colors.textOnPrimary,
  },
  controlSpacer: {
    width: 44,
  },
});
