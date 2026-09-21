/**
 * Core Fresora domain types.
 *
 * These mirror the FastAPI Pydantic schemas in backend/app/schemas.py. Keep the
 * two in sync -- the backend is the source of truth for anything the model or
 * OpenCV produces.
 */

export const FOOD_STATUSES = ['fresh', 'nearly_spoiled', 'overripe', 'spoiled'] as const;
export type FoodStatus = (typeof FOOD_STATUSES)[number];

/**
 * What an analysis response can carry.
 *
 * The backend adds `'unknown'` for the case where nothing on the surface could
 * be measured, so no score was calculated. That is deliberately *not* part of
 * `FoodStatus`: an inventory item or a saved scan always has a real status, and
 * only a live analysis result can be undetermined. Keeping them separate means
 * `STATUS_META` stays total over the four real statuses instead of needing a
 * placeholder entry, and screens have to handle the undetermined case
 * explicitly rather than falling through to a default.
 */
export type AnalysisStatus = FoodStatus | 'unknown';

export const FOOD_CATEGORIES = [
  'fruit',
  'vegetable',
  'meat',
  'poultry',
  'seafood',
  'dairy',
  'bakery',
  'other',
] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

export const STORAGE_TYPES = ['pantry', 'refrigerated', 'frozen', 'counter'] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];

/** Estimated freshness window, in days. Always an estimate, never a guarantee. */
export interface FreshnessWindow {
  min_days: number;
  max_days: number;
}

/**
 * Visual measurements from the OpenCV pipeline.
 *
 * Every field is nullable on purpose: if the backend could not compute a metric
 * for this image, it returns null and the UI hides the row rather than showing
 * a fabricated number (see the "never fabricate metric values" rule).
 *
 * All indices are normalised 0..1 unless noted.
 */
export interface VisualMetrics {
  /** Fraction of food surface showing dark spot / decay signature. */
  defect_coverage: number | null;
  /** Shift of surface hue toward brown, 0 = none. */
  browning_index: number | null;
  /** Spread of hue away from the dominant healthy hue. */
  discoloration: number | null;
  /** 1 = perfectly even texture, 0 = highly irregular. */
  texture_uniformity: number | null;
  /** 1 = one consistent colour across the surface. */
  color_consistency: number | null;
  /** Mean L* of the food region in CIELAB (0..100). */
  mean_lightness: number | null;
  /** Mean saturation of the food region (0..1). */
  mean_saturation: number | null;
}

/** Plain-language read-outs derived from the metrics above. */
export interface VisualNarrative {
  color: string;
  texture: string;
  surface: string;
  ripeness: string;
}

export interface FoodIdentification {
  food_name: string;
  category: FoodCategory;
  /** Model confidence, 0..1. */
  confidence: number;
  /** Runner-up labels, most likely first. Useful for "not right? pick another". */
  alternatives: Array<{ food_name: string; confidence: number }>;
}

export interface StorageRecommendation {
  /** Short imperative headline, e.g. "Refrigerate in a breathable bag". */
  headline: string;
  /** Supporting lines, each a single concrete action. */
  details: string[];
  storage_type: StorageType;
  preservation: string[];
}

export interface AnalysisResult {
  id: string;
  food_name: string;
  category: FoodCategory;
  /** May be 'unknown' when nothing measurable was found. */
  status: AnalysisStatus;
  /** Unified freshness score, 0..100. See backend/app/freshness.py for formula. */
  score: number;
  /** Identification confidence, 0..1. Distinct from the freshness score. */
  confidence: number;
  estimated_window: FreshnessWindow;
  visual_metrics: VisualMetrics;
  visual_narrative: VisualNarrative;
  storage_recommendation: StorageRecommendation;
  /** Human-readable reasons the score landed where it did. */
  reasoning: string[];
  safety_notice: string;
  alternatives: Array<{ food_name: string; confidence: number }>;
  /** Milliseconds the backend actually spent. Never a hard-coded claim. */
  processing_ms: number;
  model_version: string;
  analyzed_at: string;
}

export interface FoodScan {
  id: string;
  user_id: string | null;
  food_name: string;
  category: FoodCategory;
  status: FoodStatus;
  score: number;
  confidence: number;
  /** Local file URI or remote storage URL. */
  image_uri: string | null;
  analysis: AnalysisResult | null;
  /** Links repeat scans of the same physical item into a freshness journey. */
  inventory_item_id: string | null;
  scanned_at: string;
}

export interface InventoryItem {
  id: string;
  user_id: string | null;
  food_name: string;
  category: FoodCategory;
  status: FoodStatus;
  score: number | null;
  quantity: number;
  unit: string;
  image_uri: string | null;
  storage_type: StorageType;
  purchase_date: string | null;
  best_before_date: string | null;
  /** Days remaining at the moment of the most recent assessment. */
  estimated_remaining_days: number | null;
  /** When estimated_remaining_days was set -- lets us age it forward over time. */
  assessed_at: string;
  /** Set when the user marks the item consumed or discarded. */
  resolved_at: string | null;
  resolution: 'consumed' | 'discarded' | null;
  source: 'scan' | 'manual' | 'barcode' | 'receipt';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeIngredient {
  ingredient_name: string;
  quantity: string;
  /** True when this ingredient came from the user's expiring inventory. */
  is_rescued: boolean;
  inventory_item_id: string | null;
}

export interface Recipe {
  id: string;
  user_id: string | null;
  title: string;
  description: string;
  prep_minutes: number;
  cook_minutes: number;
  servings: number;
  ingredients: RecipeIngredient[];
  instructions: string[];
  /** Inventory ids this recipe puts to use. Drives the "N rescued" badge. */
  rescued_item_ids: string[];
  tips: string[];
  saved: boolean;
  /** 'llm' when generated by the configured provider, 'rules' for the offline matcher. */
  source: 'llm' | 'rules';
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string | null;
  title: string;
  message: string;
  type: 'expiry' | 'rescue' | 'priority' | 'system';
  read: boolean;
  /** Deep-link target, e.g. '/inventory'. */
  action_route: string | null;
  created_at: string;
}

export interface UserProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface UserPreferences {
  language: string;
  notifications_enabled: boolean;
  expiry_reminders: boolean;
  rescue_suggestions: boolean;
  default_category: FoodCategory | 'auto';
  default_storage: StorageType;
  dietary_preferences: string[];
}

export interface AnalyticsSummary {
  range_days: number | 'all';
  total_scans: number;
  by_status: Record<FoodStatus, number>;
  by_category: Record<string, number>;
  items_consumed: number;
  items_discarded: number;
  recipes_generated: number;
  /** Items consumed while flagged as needing attention -- our "rescued" metric. */
  items_rescued: number;
  /** Consumed / (consumed + discarded). Null when nothing has been resolved yet. */
  rescue_rate: number | null;
  scans_per_day: Array<{ date: string; count: number }>;
  rescues_per_week: Array<{ week_start: string; rescued: number; discarded: number }>;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  /** Present on assistant turns that failed, so the UI can show a retry. */
  error?: string;
}
