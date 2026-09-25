import Constants from 'expo-constants';

/**
 * Client configuration.
 *
 * Only `EXPO_PUBLIC_*` variables are readable here, and everything with that
 * prefix is **compiled into the app bundle** -- treat every value below as
 * public. Never put an LLM key or a Supabase service-role key in one; those
 * live in the backend's own .env and never leave the server.
 */

/**
 * FastAPI base URL.
 *
 * `localhost` is the device itself, not your computer, so a physical phone
 * cannot reach a dev server that way. The fallback below reads the LAN address
 * Metro is already serving from, which is almost always the right host during
 * development.
 *
 * Every read below must spell out `process.env.EXPO_PUBLIC_...` in full.
 * Expo substitutes these at build time by matching that exact expression in
 * the source, so aliasing the object first (`const env = process.env`) leaves
 * the lookup to run against an empty object at runtime. That silently dropped
 * the configured API URL from the web bundle and sent every request to
 * localhost.
 */
function inferApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  // e.g. "192.168.1.14:8081" -> "http://192.168.1.14:8000"
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:8000`;

  return 'http://localhost:8000';
}

export const API_BASE_URL = inferApiBaseUrl();
export const API_PREFIX = '/api/v1';
export const API_URL = `${API_BASE_URL}${API_PREFIX}`;

/** Requests that upload and analyse an image need a longer ceiling. */
export const API_TIMEOUT_MS = 45_000;
export const API_UPLOAD_TIMEOUT_MS = 90_000;

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
  '';

/**
 * True when both Supabase values are present.
 *
 * Drives which FoodStore the app builds and whether the auth screens offer real
 * accounts. With no project configured, Fresora runs fully on-device.
 */
export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** Image compression before upload. Keeps a scan quick on mobile data. */
export const IMAGE_MAX_DIMENSION = 1280;
export const IMAGE_COMPRESSION = 0.75;
