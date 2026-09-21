import { create } from 'zustand';

import type { AnalysisResult, FoodCategory, UserPreferences, UserProfile } from '../types';
import { DEFAULT_PREFERENCES } from '../services/storage';

/**
 * Client-only state.
 *
 * Deliberately small. Anything that lives in the database (inventory, scans,
 * recipes) is server state and belongs to React Query -- duplicating it here
 * would mean two sources of truth and stale reads (rule 43).
 *
 * What is here: session identity, preferences, connectivity, onboarding
 * progress, and the in-flight scan handoff between the scanner and the
 * analysis screen.
 */

interface PendingScan {
  /** Local URI of the compressed capture. */
  imageUri: string;
  /** Set when the user picked the food themselves or corrected the model. */
  foodName?: string;
  categoryHint?: FoodCategory;
}

interface AppState {
  // --- Session --------------------------------------------------------
  userId: string | null;
  profile: UserProfile | null;
  /** True once auth and preferences have loaded, so the router can decide. */
  ready: boolean;
  onboarded: boolean;

  // --- Preferences ----------------------------------------------------
  preferences: UserPreferences;

  // --- Connectivity ---------------------------------------------------
  online: boolean;
  /** Whether the backend's classifier and LLM are actually usable. */
  capabilities: {
    classifierAvailable: boolean;
    llmConfigured: boolean;
    /** Null until the health check has run at least once. */
    reachable: boolean | null;
  };

  // --- Scan handoff ---------------------------------------------------
  /**
   * The capture being analysed.
   *
   * Passed through the store rather than a route param because an image URI in
   * a URL is fragile, and the analysis screen also needs it on retry.
   */
  pendingScan: PendingScan | null;
  /** The most recent result, for the analysis screen and Ask AI context. */
  lastAnalysis: AnalysisResult | null;

  // --- Actions --------------------------------------------------------
  setSession: (userId: string | null, profile: UserProfile | null) => void;
  setReady: (ready: boolean) => void;
  setOnboarded: (onboarded: boolean) => void;
  setPreferences: (preferences: UserPreferences) => void;
  patchPreferences: (patch: Partial<UserPreferences>) => void;
  setOnline: (online: boolean) => void;
  setCapabilities: (capabilities: Partial<AppState['capabilities']>) => void;
  setPendingScan: (scan: PendingScan | null) => void;
  setLastAnalysis: (analysis: AnalysisResult | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  userId: null,
  profile: null,
  ready: false,
  onboarded: false,
  preferences: DEFAULT_PREFERENCES,
  online: true,
  capabilities: {
    classifierAvailable: false,
    llmConfigured: false,
    reachable: null,
  },
  pendingScan: null,
  lastAnalysis: null,

  setSession: (userId, profile) => set({ userId, profile }),
  setReady: (ready) => set({ ready }),
  setOnboarded: (onboarded) => set({ onboarded }),
  setPreferences: (preferences) => set({ preferences }),
  patchPreferences: (patch) =>
    set((state) => ({ preferences: { ...state.preferences, ...patch } })),
  setOnline: (online) => set({ online }),
  setCapabilities: (capabilities) =>
    set((state) => ({ capabilities: { ...state.capabilities, ...capabilities } })),
  setPendingScan: (pendingScan) => set({ pendingScan }),
  setLastAnalysis: (lastAnalysis) => set({ lastAnalysis }),

  reset: () =>
    set({
      userId: null,
      profile: null,
      preferences: DEFAULT_PREFERENCES,
      pendingScan: null,
      lastAnalysis: null,
    }),
}));

/**
 * Selector hooks.
 *
 * Subscribing to a slice rather than the whole store means a connectivity
 * change does not re-render every screen that only reads preferences.
 */
export const useOnline = () => useAppStore((state) => state.online);
export const usePreferences = () => useAppStore((state) => state.preferences);
export const useCapabilities = () => useAppStore((state) => state.capabilities);
export const useSessionUserId = () => useAppStore((state) => state.userId);
