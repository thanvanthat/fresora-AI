import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_CONFIGURED, SUPABASE_URL } from '../constants/config';

/**
 * Lazily-built Supabase client.
 *
 * Built on first use rather than at import, so the app starts normally when no
 * project is configured. `getSupabase()` throws in that case -- callers must
 * check `SUPABASE_CONFIGURED` first, which every call site does.
 *
 * Session persistence goes through AsyncStorage. `detectSessionInUrl` is false
 * because there is no URL to parse in a native app, and leaving it on causes a
 * warning on every launch.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!SUPABASE_CONFIGURED) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and ' +
        'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the dev server.',
    );
  }

  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}

/** Drops the cached client. Used after sign-out in tests. */
export function resetSupabase(): void {
  client = null;
}
