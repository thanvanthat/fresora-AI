import { SUPABASE_CONFIGURED } from '../../constants/config';
import { LocalFoodStore } from './local';
import { SupabaseFoodStore } from './supabase';
import type { FoodStore } from './types';

export type { FoodStore } from './types';
export { DEFAULT_PREFERENCES } from './types';
export { LocalFoodStore } from './local';
export { SupabaseFoodStore } from './supabase';

/**
 * Picks the store once, at first use.
 *
 * Supabase when a project is configured *and* someone is signed in; the local
 * store otherwise. The choice is re-evaluated on sign-in and sign-out via
 * `setSignedIn`, because a configured project with no session must still fall
 * back to local rather than throwing on every query.
 */
let store: FoodStore | null = null;
let signedIn = false;

export function getStore(): FoodStore {
  if (!store) {
    store = SUPABASE_CONFIGURED && signedIn ? new SupabaseFoodStore() : new LocalFoodStore();
  }
  return store;
}

/** Call after auth state changes so the next getStore() picks the right one. */
export function setSignedIn(next: boolean): void {
  if (next === signedIn) return;
  signedIn = next;
  store = null;
}

/** The local store specifically, for migrating device data into an account. */
export const localStore = new LocalFoodStore();
