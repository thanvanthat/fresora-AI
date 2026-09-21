import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Body, Caption, Title } from '../../components/Text';
import { useTranslation } from '../../i18n';
import { ANALYSIS_STAGES } from '../../hooks/useAnalysis';
import { GUTTER, colors, palette, radius, spacing } from '../../theme';

interface AnalysisProgressProps {
  imageUri: string;
  stageKey: string;
  stage: number;
  totalStages: number;
  onCancel: () => void;
}

/**
 * The "analysing your food" state.
 *
 * Shows the captured image with a sweeping scan line and a checklist of stages.
 *
 * Honesty note: the backend does not stream progress, so the stage list is a
 * description of the work being done, advanced on a timer, and the last stage
 * holds until the real response arrives. There is deliberately no percentage
 * and no ETA, because either would be invented (rule 13).
 */
export function AnalysisProgress({
  imageUri,
  stageKey,
  stage,
  totalStages,
  onCancel,
}: AnalysisProgressProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const scan = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sweep, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 800, useNativeDriver: true }),
      ]),
    );

    scan.start();
    breathe.start();
    return () => {
      scan.stop();
      breathe.stop();
    };
  }, [sweep, pulse]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xxl }]}>
      <View style={styles.imageWrap}>
        <Image
          source={{ uri: imageUri }}
          style={styles.image}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
        {/* Sweeping scan line. */}
        <Animated.View
          style={[
            styles.scanLine,
            {
              transform: [
                {
                  translateY: sweep.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 236],
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      <Animated.View style={{ opacity: pulse }}>
        <Title align="center" style={styles.title}>
          {t('scanner.analyzing')}
        </Title>
      </Animated.View>

      {/* Stage checklist. */}
      <View
        style={styles.stages}
        accessibilityRole="progressbar"
        accessibilityValue={{ now: stage + 1, min: 1, max: totalStages }}
      >
        {ANALYSIS_STAGES.map((key, index) => {
          const done = index < stage;
          const active = index === stage;

          return (
            <View key={key} style={styles.stageRow}>
              <View
                style={[
                  styles.stageDot,
                  done ? styles.stageDotDone : null,
                  active ? styles.stageDotActive : null,
                ]}
              >
                {done ? <Icon name="check" size={11} color={colors.textOnPrimary} /> : null}
              </View>
              <Body
                style={[
                  styles.stageLabel,
                  active ? styles.stageLabelActive : null,
                  done ? styles.stageLabelDone : null,
                ]}
              >
                {t(key)}
              </Body>
            </View>
          );
        })}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Caption align="center" style={styles.footerNote}>
          {t('safety.shortNotice')}
        </Caption>
        <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: GUTTER,
    alignItems: 'center',
  },
  imageWrap: {
    width: 236,
    height: 236,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.onCamera,
    shadowColor: palette.white,
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  title: {
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
  },
  stages: {
    alignSelf: 'stretch',
    gap: spacing.md,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stageDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageDotDone: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stageDotActive: {
    borderColor: colors.primary,
    borderWidth: 2.5,
  },
  stageLabel: {
    flex: 1,
  },
  stageLabelActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  stageLabelDone: {
    color: colors.textTertiary,
  },
  footer: {
    marginTop: 'auto',
    alignSelf: 'stretch',
    gap: spacing.base,
  },
  footerNote: {
    lineHeight: 17,
  },
});
