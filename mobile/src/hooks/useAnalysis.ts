import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { analyzeImage, toAnalysisResult, type AnalyzeResponse } from '../services/api/endpoints';
import { prepareForUpload } from '../services/image';
import { useAppStore } from '../store/app';
import type { FoodCategory, StorageType } from '../types';

/**
 * Runs an image through the analysis endpoint.
 *
 * The staged progress display is honest about what it knows: the backend does
 * not stream progress, so these are *labels for the work being done*, advanced
 * on a timer, and the final stage holds until the real response lands. It never
 * claims a completion percentage it cannot observe, and it never shows a
 * fabricated duration.
 */

export const ANALYSIS_STAGES = [
  'scanner.stageIdentify',
  'scanner.stageCondition',
  'scanner.stageColor',
  'scanner.stageTexture',
  'scanner.stageFreshness',
  'scanner.stageRecommend',
] as const;

/** How long each label shows before advancing, in ms. */
const STAGE_INTERVAL = 550;

export interface AnalyzeInput {
  imageUri: string;
  foodName?: string;
  categoryHint?: FoodCategory;
  storageType?: StorageType;
}

export function useAnalyzeImage() {
  const setLastAnalysis = useAppStore((state) => state.setLastAnalysis);

  const [stage, setStage] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const abort = useRef<AbortController | null>(null);

  const stopStages = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const startStages = useCallback(() => {
    setStage(0);
    stopStages();
    timer.current = setInterval(() => {
      // Hold on the last stage rather than looping: pretending to restart
      // would imply progress that is not happening.
      setStage((current) => Math.min(current + 1, ANALYSIS_STAGES.length - 1));
    }, STAGE_INTERVAL);
  }, [stopStages]);

  // Clean up if the screen unmounts mid-analysis.
  useEffect(
    () => () => {
      stopStages();
      abort.current?.abort();
    },
    [stopStages],
  );

  const mutation = useMutation({
    mutationFn: async (input: AnalyzeInput): Promise<AnalyzeResponse> => {
      startStages();
      abort.current = new AbortController();

      const prepared = await prepareForUpload(input.imageUri);

      return analyzeImage(prepared.upload, {
        foodName: input.foodName,
        categoryHint: input.categoryHint,
        storageType: input.storageType,
        signal: abort.current.signal,
      });
    },
    onSuccess: (response) => {
      stopStages();
      setStage(ANALYSIS_STAGES.length - 1);
      setLastAnalysis(toAnalysisResult(response, `${Date.now()}`));
    },
    onError: stopStages,
  });

  const cancel = useCallback(() => {
    abort.current?.abort();
    stopStages();
    mutation.reset();
  }, [mutation, stopStages]);

  return {
    ...mutation,
    /** Index into ANALYSIS_STAGES. */
    stage,
    stageKey: ANALYSIS_STAGES[stage],
    totalStages: ANALYSIS_STAGES.length,
    cancel,
  };
}
