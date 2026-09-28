import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';

import { detectFoods, type DetectResponse } from '../services/api/endpoints';
import { prepareForUpload } from '../services/image';

/**
 * Finds every food item in one photo.
 *
 * Deliberately simpler than `useAnalyzeImage`: detection is a single fast pass
 * rather than a staged pipeline, so there is no progress display to fake. A
 * warm call returns in ~150ms and a spinner is the honest representation of
 * that.
 */
export function useDetectFoods() {
  const abort = useRef<AbortController | null>(null);

  const mutation = useMutation<DetectResponse, Error, string>({
    mutationFn: async (imageUri: string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      const prepared = await prepareForUpload(imageUri);
      return detectFoods(prepared.upload, controller.signal);
    },
  });

  return {
    ...mutation,
    /** Cancels an in-flight request; the screen calls this on unmount. */
    cancel: () => {
      abort.current?.abort();
      abort.current = null;
    },
  };
}
