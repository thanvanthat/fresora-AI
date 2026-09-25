import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConfidenceBadge, Pill } from '../src/components/Badge';
import { Button, Chip, PrimaryButton, SecondaryButton } from '../src/components/Button';
import { Card, Divider, Section } from '../src/components/Card';
import { BottomSheet } from '../src/components/Controls';
import { InfoCard, ShelfLifeCard } from '../src/components/FoodCard';
import { Gutter, Screen } from '../src/components/Screen';
import { CircularScore, MetricRow } from '../src/components/Score';
import { EmptyState, ErrorState, SafetyNotice } from '../src/components/States';
import { Body, Caption, Display, Eyebrow, Label, Title } from '../src/components/Text';
import { useToast } from '../src/components/Toast';
import { LOW_CONFIDENCE_THRESHOLD } from '../src/constants/safety';
import { AnalysisProgress } from '../src/features/analysis/AnalysisProgress';
import { useAddInventoryItem } from '../src/hooks/useInventory';
import { useAnalyzeImage } from '../src/hooks/useAnalysis';
import { useAddScan } from '../src/hooks/useScans';
import { useTranslation } from '../src/i18n';
import { ApiError } from '../src/services/api/client';
import { persistImage } from '../src/services/image';
import { useAppStore, useCapabilities } from '../src/store/app';
import { colors, spacing } from '../src/theme';

/**
 * Analysis result.
 *
 * Follows the reference layout exactly: image, then the big score, then the
 * status, then details, then shelf life, then storage, then the actions. The
 * user learns what it is, what condition it is in, and what to do -- in that
 * order.
 *
 * Every number on this screen comes from the backend. Nothing is interpolated
 * and nothing is filled in when the backend returned null.
 */
export default function AnalysisScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const capabilities = useCapabilities();

  const pendingScan = useAppStore((state) => state.pendingScan);
  const setPendingScan = useAppStore((state) => state.setPendingScan);

  const analyze = useAnalyzeImage();
  const addScan = useAddScan();
  const addItem = useAddInventoryItem();

  const [saved, setSaved] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);

  const result = analyze.data;

  // Kick off the analysis when the screen opens with a pending capture.
  useEffect(() => {
    if (pendingScan && analyze.isIdle) {
      analyze.mutate({
        imageUri: pendingScan.imageUri,
        foodName: pendingScan.foodName,
        categoryHint: pendingScan.categoryHint,
      });
    }
    // `analyze` is recreated each render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScan]);

  /** Re-runs the analysis with a corrected food name. */
  const reanalyzeAs = (foodName: string) => {
    if (!pendingScan) return;
    setShowAlternatives(false);
    setSaved(false);
    analyze.reset();
    setPendingScan({ ...pendingScan, foodName });
  };

  const onAddToInventory = async () => {
    if (!result || !pendingScan) return;

    // Nothing measurable means nothing worth recording. Defaulting an
    // undetermined result to "fresh" would put a made-up status in the user's
    // inventory, so the action is refused instead (the button is disabled too).
    if (result.status === 'unknown') return;

    const scanId = `${Date.now()}`;
    const storedUri = await persistImage(pendingScan.imageUri, scanId);

    const item = await addItem.mutateAsync({
      food_name: result.food_name,
      category: result.category,
      status: result.status,
      score: result.score,
      quantity: 1,
      unit: 'item',
      image_uri: storedUri,
      storage_type: result.storage_recommendation.storage_type,
      purchase_date: null,
      best_before_date: null,
      estimated_remaining_days: result.estimated_window.max_days,
      assessed_at: new Date().toISOString(),
      resolved_at: null,
      resolution: null,
      source: 'scan',
      notes: null,
    });

    // Link the scan to the item so repeat scans build a freshness journey.
    await addScan.mutateAsync({
      food_name: result.food_name,
      category: result.category,
      status: result.status,
      score: result.score,
      confidence: result.confidence,
      image_uri: storedUri,
      analysis: null,
      inventory_item_id: item.id,
      scanned_at: new Date().toISOString(),
    });

    setSaved(true);
    toast.show(t('analysis.addedToInventory'));
  };

  // --- No capture -----------------------------------------------------
  if (!pendingScan) {
    return (
      <Screen showBack title={t('analysis.title')} tabBarPadding={false}>
        <ErrorState
          title={t('errors.genericTitle')}
          body={t('errors.genericBody')}
          retryLabel={t('home.scanFood')}
          onRetry={() => router.replace('/scan')}
        />
      </Screen>
    );
  }

  // --- Working --------------------------------------------------------
  if (analyze.isPending) {
    return (
      <AnalysisProgress
        imageUri={pendingScan.imageUri}
        stageKey={analyze.stageKey}
        stage={analyze.stage}
        totalStages={analyze.totalStages}
        onCancel={() => {
          analyze.cancel();
          router.back();
        }}
      />
    );
  }

  // --- Failed ---------------------------------------------------------
  if (analyze.isError) {
    const error = analyze.error;
    const isApi = error instanceof ApiError;

    // Identification is an optional component, and this deployment runs
    // without it. That is a known configuration rather than a failure, and
    // retrying cannot change it -- the same request would fail identically
    // every time. Offering "Try again" as the primary action was a dead end,
    // so send the user straight to naming the food, which is the path that
    // actually completes the scan.
    if (isApi && error.code === 'model_unavailable') {
      return (
        <Screen showBack title={t('analysis.title')} tabBarPadding={false}>
          {/* EmptyState, not ErrorState: nothing has gone wrong, so the red
              alert styling and the assertive alert role would both misreport
              what the user is looking at. */}
          <EmptyState
            icon="search"
            title={t('errors.modelTitle')}
            body={t('errors.modelBody')}
            actionLabel={t('analysis.nameYourFood')}
            onAction={() => setShowAlternatives(true)}
          />

          <NamePicker
            visible={showAlternatives}
            onClose={() => setShowAlternatives(false)}
            onPick={reanalyzeAs}
          />
        </Screen>
      );
    }

    return (
      <Screen showBack title={t('analysis.title')} tabBarPadding={false}>
        <ErrorState
          title={t(isApi ? error.titleKey : 'errors.genericTitle')}
          body={t(isApi ? error.bodyKey : 'errors.genericBody')}
          retryLabel={t('common.retry')}
          onRetry={() =>
            analyze.mutate({
              imageUri: pendingScan.imageUri,
              foodName: pendingScan.foodName,
              categoryHint: pendingScan.categoryHint,
            })
          }
          secondaryLabel={t('analysis.pickAlternative')}
          onSecondary={() => setShowAlternatives(true)}
        />

        {/* When identification is unavailable, naming the food still works. */}
        <NamePicker
          visible={showAlternatives}
          onClose={() => setShowAlternatives(false)}
          onPick={reanalyzeAs}
        />
      </Screen>
    );
  }

  if (!result) return null;

  const lowConfidence =
    result.identified && result.confidence > 0 && result.confidence < LOW_CONFIDENCE_THRESHOLD;

  const windowText =
    result.estimated_window.max_days <= 1
      ? t('analysis.windowSingle', { max: result.estimated_window.max_days })
      : t('analysis.windowRange', {
          min: result.estimated_window.min_days,
          max: result.estimated_window.max_days,
        });

  const windowHeadline =
    result.estimated_window.max_days === 0
      ? t('status.spoiled')
      : `~${result.estimated_window.max_days} ${
          result.estimated_window.max_days === 1 ? t('common.day') : t('common.days', { count: result.estimated_window.max_days })
        }`.replace(/~1 1 /, '~1 ');

  return (
    <Screen showBack title={t('analysis.title')} tabBarPadding={false}>
      {/* --- Hero image + score -------------------------------------- */}
      <Gutter>
        <View style={styles.hero}>
          <Image
            source={{ uri: pendingScan.imageUri }}
            style={styles.heroImage}
            contentFit="cover"
            transition={220}
            accessibilityIgnoresInvertColors
          />
          {result.confidence > 0 ? (
            <ConfidenceBadge confidence={result.confidence} style={styles.heroBadge} />
          ) : null}
        </View>

        <Display align="center" style={styles.foodName}>
          {result.food_name}
        </Display>

        {/* Two different jobs share this control. When the model named the
            food, it is a correction affordance and stays quiet. When nothing
            was identified, naming the food is the only way to get a score, so
            it becomes the primary action -- and the "Not a {food}?" phrasing
            would read as "Not a Unidentified item?". */}
        <Button
          label={
            result.identified
              ? t('analysis.notThisFood', { food: result.food_name })
              : t('analysis.nameYourFood')
          }
          variant={result.identified ? 'ghost' : 'primary'}
          size={result.identified ? 'sm' : 'md'}
          fullWidth={!result.identified}
          onPress={() => setShowAlternatives(true)}
          style={styles.notThis}
        />

        {result.status !== 'unknown' ? (
          <CircularScore score={result.score} status={result.status} style={styles.score} />
        ) : null}

        {lowConfidence ? (
          <InfoCard
            title={t('safety.lowConfidence')}
            body={t('analysis.pickAlternative')}
            icon="alert-triangle"
            tone="warning"
            style={styles.lowConfidence}
          />
        ) : null}

        {result.note ? <Caption style={styles.note}>{result.note}</Caption> : null}
      </Gutter>

      {/* --- Analysis details ---------------------------------------- */}
      <Section title={t('analysis.detailsTitle')}>
        <Card>
          <DetailRow label={t('analysis.color')} value={result.visual_narrative.color} />
          <Divider style={styles.detailDivider} />
          <DetailRow label={t('analysis.texture')} value={result.visual_narrative.texture} />
          <Divider style={styles.detailDivider} />
          <DetailRow label={t('analysis.surface')} value={result.visual_narrative.surface} />
          <Divider style={styles.detailDivider} />
          <DetailRow label={t('analysis.ripeness')} value={result.visual_narrative.ripeness} />
          {result.confidence > 0 ? (
            <>
              <Divider style={styles.detailDivider} />
              <DetailRow
                label={t('analysis.confidence')}
                value={t('analysis.modelConfidence', {
                  percent: Math.round(result.confidence * 100),
                })}
              />
            </>
          ) : null}
        </Card>
      </Section>

      {/* --- Why this result? ---------------------------------------- */}
      {result.reasoning.length > 0 ? (
        <Section>
          <Card
            onPress={() => setShowReasoning((prior) => !prior)}
            accessibilityLabel={t('analysis.whyTitle')}
          >
            <View style={styles.whyHeader}>
              <Label>{t('analysis.whyTitle')}</Label>
              <Caption>{showReasoning ? '−' : '+'}</Caption>
            </View>
            {showReasoning ? (
              <View style={styles.whyBody}>
                {result.reasoning.map((reason, index) => (
                  <Body key={index} style={styles.whyLine}>
                    • {reason}
                  </Body>
                ))}
                <View style={styles.provenance}>
                  <Pill label={result.scoring_method} icon="info" />
                  <Pill
                    label={t('analysis.measuredIn', { ms: result.processing_ms })}
                    icon="clock"
                  />
                  <Pill label={t('analysis.modelVersion', { version: result.model_version })} />
                </View>
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* --- Visual metrics ------------------------------------------ */}
      <Section title={t('analysis.metricsTitle')}>
        <Card>
          <MetricRow
            label={t('analysis.metricColorConsistency')}
            value={result.visual_metrics.color_consistency}
            explanation={t('analysis.explainColorConsistency')}
            notMeasuredLabel={t('analysis.metricNotAvailable')}
          />
          <MetricRow
            label={t('analysis.metricTextureUniformity')}
            value={result.visual_metrics.texture_uniformity}
            explanation={t('analysis.explainTexture')}
            notMeasuredLabel={t('analysis.metricNotAvailable')}
          />
          <MetricRow
            label={t('analysis.metricDefectCoverage')}
            value={result.visual_metrics.defect_coverage}
            explanation={t('analysis.explainDefect')}
            inverted
            notMeasuredLabel={t('analysis.metricNotAvailable')}
          />
          <MetricRow
            label={t('analysis.metricBrowning')}
            value={result.visual_metrics.browning_index}
            explanation={t('analysis.explainBrowning')}
            inverted
            notMeasuredLabel={t('analysis.metricNotAvailable')}
          />
          <MetricRow
            label={t('analysis.metricDiscoloration')}
            value={result.visual_metrics.discoloration}
            explanation={t('analysis.explainDiscoloration')}
            inverted
            notMeasuredLabel={t('analysis.metricNotAvailable')}
          />
        </Card>
      </Section>

      {/* --- Shelf life + next step ---------------------------------- */}
      <Section>
        <Gutter>
          <ShelfLifeCard
            estimatedLabel={t('analysis.windowTitle')}
            headline={windowHeadline}
            detail={windowText}
            actionTitle={t('analysis.whatNow')}
            action={result.recommended_action}
          />
        </Gutter>
      </Section>

      {/* --- Storage -------------------------------------------------- */}
      <Section title={t('analysis.bestNextStep')}>
        <InfoCard
          title={result.storage_recommendation.headline}
          body={result.storage_recommendation.details}
          icon="fridge"
        />
        {result.storage_recommendation.preservation.length > 0 ? (
          <View style={styles.preservation}>
            {result.storage_recommendation.preservation.map((method) => (
              <Pill key={method} label={method} tone="sage" icon="snowflake" />
            ))}
          </View>
        ) : null}
      </Section>

      {/* --- Actions -------------------------------------------------- */}
      <Gutter style={styles.actions}>
        <PrimaryButton
          label={saved ? t('analysis.addedToInventory') : t('analysis.addToInventory')}
          icon={saved ? 'check' : 'plus'}
          disabled={saved || addItem.isPending || result.status === 'unknown'}
          loading={addItem.isPending}
          onPress={onAddToInventory}
        />
        <SecondaryButton
          label={t('analysis.askAi')}
          icon="message"
          onPress={() =>
            router.push({
              pathname: '/assistant',
              params: { food: result.food_name, status: result.status, score: result.score },
            })
          }
        />
        <Button
          label={t('analysis.scanAgain')}
          variant="ghost"
          icon="camera"
          onPress={() => {
            setPendingScan(null);
            router.replace('/scan');
          }}
        />

        <SafetyNotice text={result.safety_notice} />
      </Gutter>

      <NamePicker
        visible={showAlternatives}
        onClose={() => setShowAlternatives(false)}
        onPick={reanalyzeAs}
        alternatives={result.alternatives.map((alternative) => alternative.food_name)}
      />
    </Screen>
  );
}

/** One label/value row in the details card. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Caption style={styles.detailLabel}>{label}</Caption>
      <Body style={styles.detailValue}>{value}</Body>
    </View>
  );
}

/**
 * Food-name picker.
 *
 * The list comes from the backend's own knowledge base, so the app cannot offer
 * a food the server has no data for. Loaded lazily when the sheet opens.
 */
function NamePicker({
  visible,
  onClose,
  onPick,
  alternatives = [],
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (foodName: string) => void;
  alternatives?: string[];
}) {
  const { t } = useTranslation();
  const [foods, setFoods] = useState<string[]>([]);

  useEffect(() => {
    if (!visible || foods.length > 0) return;

    import('../src/services/api/endpoints')
      .then(({ listKnownFoods }) => listKnownFoods())
      .then((response) => setFoods(response.foods))
      .catch(() => setFoods([]));
  }, [visible, foods.length]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('analysis.pickAlternative')}>
      {alternatives.length > 0 ? (
        <View style={styles.pickerGroup}>
          <Eyebrow>{t('analysis.confidence')}</Eyebrow>
          <View style={styles.pickerChips}>
            {alternatives.map((name) => (
              <Chip key={name} label={name} onPress={() => onPick(name)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.pickerGroup}>
        <Eyebrow>{t('inventory.foodName')}</Eyebrow>
        <View style={styles.pickerChips}>
          {foods.map((name) => (
            <Chip key={name} label={name} onPress={() => onPick(name)} />
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
  },
  heroImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 24,
    backgroundColor: colors.surfaceAlt,
  },
  heroBadge: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
  },
  foodName: {
    marginTop: spacing.xl,
  },
  notThis: {
    alignSelf: 'center',
  },
  score: {
    marginTop: spacing.base,
    marginBottom: spacing.lg,
  },
  lowConfidence: {
    marginTop: spacing.base,
  },
  note: {
    marginTop: spacing.md,
    lineHeight: 18,
  },
  detailRow: {
    paddingVertical: spacing.md,
    gap: 3,
  },
  detailLabel: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  detailValue: {
    color: colors.textPrimary,
    lineHeight: 22,
  },
  detailDivider: {
    opacity: 0.6,
  },
  whyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  whyBody: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  whyLine: {
    lineHeight: 21,
  },
  provenance: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  preservation: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  pickerGroup: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  pickerChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
