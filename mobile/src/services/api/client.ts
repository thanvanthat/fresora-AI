import { Platform } from 'react-native';

import { API_TIMEOUT_MS, API_UPLOAD_TIMEOUT_MS, API_URL } from '../../constants/config';
import { useAppStore } from '../../store/app';

/**
 * Typed fetch wrapper for the Fresora API.
 *
 * Its job is to turn every possible failure into an `ApiError` carrying a
 * **stable machine code**. Screens map that code to a localised string from the
 * app dictionary, which is how raw server text and stack traces are kept off
 * the user's screen (rule 37).
 */

/** Codes the UI switches on. Keep in step with `errors.*` in the locales. */
export type ApiErrorCode =
  | 'network'
  | 'timeout'
  | 'server'
  | 'model_unavailable'
  | 'invalid_image'
  | 'unsupported_image'
  | 'image_too_large'
  | 'empty_upload'
  | 'empty_inventory'
  | 'unknown_food'
  | 'validation'
  | 'unauthorized'
  | 'unknown';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;

  constructor(code: ApiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  /** i18n key for a user-facing title. */
  get titleKey(): string {
    switch (this.code) {
      case 'network':
        return 'errors.networkTitle';
      case 'timeout':
      case 'server':
        return 'errors.serverTitle';
      case 'model_unavailable':
        return 'errors.modelTitle';
      case 'invalid_image':
      case 'unsupported_image':
      case 'image_too_large':
      case 'empty_upload':
        return 'errors.imageTitle';
      case 'unauthorized':
        return 'errors.sessionExpiredTitle';
      default:
        return 'errors.genericTitle';
    }
  }

  /** i18n key for a user-facing body. */
  get bodyKey(): string {
    switch (this.code) {
      case 'network':
        return 'errors.networkBody';
      case 'timeout':
      case 'server':
        return 'errors.serverBody';
      case 'model_unavailable':
        return 'errors.modelBody';
      case 'invalid_image':
      case 'empty_upload':
        return 'errors.imageBody';
      case 'unsupported_image':
        return 'errors.unsupportedImage';
      case 'image_too_large':
        return 'errors.imageTooLarge';
      case 'unauthorized':
        return 'errors.sessionExpiredBody';
      default:
        return 'errors.genericBody';
    }
  }
}

/** Maps an HTTP status plus the server's error envelope onto an ApiErrorCode. */
function codeFor(status: number, payload: unknown): ApiErrorCode {
  // FastAPI wraps HTTPException detail; ours is { code, message }.
  const detail =
    payload && typeof payload === 'object' && 'detail' in payload
      ? (payload as { detail: unknown }).detail
      : payload;

  if (detail && typeof detail === 'object' && 'code' in detail) {
    const raw = String((detail as { code: unknown }).code);
    const known: ApiErrorCode[] = [
      'model_unavailable',
      'invalid_image',
      'unsupported_image',
      'image_too_large',
      'empty_upload',
      'empty_inventory',
      'unknown_food',
    ];
    if ((known as string[]).includes(raw)) return raw as ApiErrorCode;
  }

  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Runs a fetch with a timeout, honouring any caller-supplied abort signal.
 *
 * `AbortSignal.any` is not available in the Hermes runtime, so the two signals
 * are bridged manually.
 */
async function withTimeout(
  input: string,
  init: RequestInit,
  { signal, timeoutMs = API_TIMEOUT_MS }: RequestOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    // A caller-initiated cancel is not an error condition; re-throw as-is so
    // React Query treats it as a cancellation rather than a failure.
    if (signal?.aborted) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('timeout', 'The request took too long.');
    }

    // A failed fetch has two very different causes, and they need different
    // advice. Reporting both as "you're offline" sent the user to check their
    // internet when the real problem was a server that was not running.
    //
    // The live connectivity flag comes from the NetInfo listener in the root
    // layout, so this is a cheap read of state that is already maintained --
    // no extra async probe in the failure path.
    const deviceIsOnline = useAppStore.getState().online;

    throw new ApiError(
      deviceIsOnline ? 'server' : 'network',
      deviceIsOnline
        ? 'The device has a connection but the Fresora server did not respond.'
        : 'The device has no network connection.',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await parseBody(response);
    const code = codeFor(response.status, payload);

    // The message is for logs only -- the UI renders titleKey/bodyKey.
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? (payload as { detail: { message?: string } }).detail
        : null;

    throw new ApiError(
      code,
      detail?.message ?? `HTTP ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export async function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await withTimeout(`${API_URL}${path}`, { method: 'GET' }, options);
  return handle<T>(response);
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const response = await withTimeout(
    `${API_URL}${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    options,
  );
  return handle<T>(response);
}

export interface UploadField {
  uri: string;
  name: string;
  type: string;
}

/**
 * Turns an image reference into whatever this platform's FormData understands.
 *
 * React Native's FormData accepts `{ uri, name, type }` and streams the file
 * from disk. The browser's does not: it is the DOM FormData, which stringifies
 * any non-Blob value, so that same object is sent as the literal text
 * "[object Object]" and the server rejects the request as a missing file. On
 * web the URI is a blob:/data: URL, so fetching it back yields the real bytes
 * to send as a File.
 */
async function toFormFile(file: UploadField): Promise<Blob | UploadField> {
  if (Platform.OS !== 'web') return file;

  const blob = await (await fetch(file.uri)).blob();
  return new File([blob], file.name, { type: file.type || blob.type });
}

/**
 * Multipart upload for image analysis.
 *
 * The content-type header is deliberately omitted: fetch has to set it so the
 * multipart boundary is correct.
 */
export async function apiUpload<T>(
  path: string,
  file: UploadField,
  fields: Record<string, string | undefined> = {},
  options: RequestOptions = {},
): Promise<T> {
  const form = new FormData();
  const value = await toFormFile(file);

  if (value instanceof Blob) {
    form.append('image', value, file.name);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RN FormData file shape
    form.append('image', value as any);
  }

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== '') form.append(key, value);
  }

  const response = await withTimeout(
    `${API_URL}${path}`,
    { method: 'POST', body: form },
    { timeoutMs: API_UPLOAD_TIMEOUT_MS, ...options },
  );
  return handle<T>(response);
}
