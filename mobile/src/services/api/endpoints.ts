import type {
  AnalysisResult,
  AnalysisStatus,
  FoodCategory,
  FoodStatus,
  FreshnessWindow,
  Recipe,
  StorageRecommendation,
  StorageType,
  VisualMetrics,
  VisualNarrative,
} from '../../types';
import { apiGet, apiPost, apiUpload, type UploadField } from './client';

/**
 * One function per backend route. Screens call these through React Query hooks
 * and never build a URL themselves.
 */

// --- Wire shapes ---------------------------------------------------------

/** Exactly what POST /analyze returns. Mirrors backend/app/schemas.py. */
export interface AnalyzeResponse {
  food_name: string;
  category: FoodCategory;
  status: AnalysisStatus;
  score: number;
  confidence: number;
  identified: boolean;
  estimated_window: FreshnessWindow;
  visual_metrics: VisualMetrics;
  visual_narrative: VisualNarrative;
  storage_recommendation: StorageRecommendation;
  recommended_action: string;
  reasoning: string[];
  alternatives: Array<{ food_name: string; confidence: number }>;
  safety_notice: string;
  scoring_method: string;
  processing_ms: number;
  model_version: string;
  mask_source: string;
  note: string | null;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  classifier_available: boolean;
  classifier_mode: string;
  llm_configured: boolean;
  known_foods: number;
}

export interface RecipeResponseWire {
  title: string;
  description: string;
  prep_minutes: number;
  cook_minutes: number;
  servings: number;
  ingredients: Array<{
    ingredient_name: string;
    quantity: string;
    is_rescued: boolean;
    inventory_item_id: string | null;
  }>;
  instructions: string[];
  rescued_item_ids: string[];
  tips: string[];
  source: 'llm' | 'rules';
  excluded_item_ids: string[];
  safety_notice: string;
  note: string | null;
}

export interface AssistantResponseWire {
  reply: string;
  source: 'llm' | 'knowledge';
  grounded_on: string[];
  suggested_actions: string[];
  safety_notice: string;
}

export interface ShelfLifeResponse {
  food_name: string;
  estimated_window: FreshnessWindow;
  typical_window: FreshnessWindow | null;
  storage_type: StorageType;
  recommended_action: string;
  is_estimate: boolean;
  safety_notice: string;
  note: string | null;
}

export interface StorageResponse {
  food_name: string;
  recommendation: StorageRecommendation;
  nutrition: string | null;
  recipe_uses: string[];
  known: boolean;
  note: string | null;
}

/** An inventory item as the recipe and assistant endpoints expect it. */
export interface InventoryPayload {
  id: string;
  food_name: string;
  category: FoodCategory;
  status: FoodStatus;
  estimated_remaining_days: number | null;
  quantity: number;
  unit: string;
}

// --- Routes --------------------------------------------------------------

export const getHealth = (signal?: AbortSignal) =>
  apiGet<HealthResponse>('/health', { signal, timeoutMs: 8000 });

export const analyzeImage = (
  file: UploadField,
  options: {
    foodName?: string;
    categoryHint?: FoodCategory;
    storageType?: StorageType;
    signal?: AbortSignal;
  } = {},
) =>
  apiUpload<AnalyzeResponse>(
    '/analyze',
    file,
    {
      food_name: options.foodName,
      category_hint: options.categoryHint,
      storage_type: options.storageType,
    },
    { signal: options.signal },
  );

export const identifyFood = (file: UploadField, signal?: AbortSignal) =>
  apiUpload<{
    identified: boolean;
    food_name: string | null;
    category: FoodCategory | null;
    confidence: number;
    alternatives: Array<{ food_name: string; confidence: number }>;
    looks_like_food: boolean;
    model_version: string;
    note: string | null;
  }>('/food/identify', file, {}, { signal });

export const getShelfLife = (
  body: { food_name: string; status?: FoodStatus; score?: number; storage_type?: StorageType },
  signal?: AbortSignal,
) => apiPost<ShelfLifeResponse>('/shelf-life', body, { signal });

export const getStorageRecommendation = (
  body: { food_name: string; storage_type?: StorageType },
  signal?: AbortSignal,
) => apiPost<StorageResponse>('/storage-recommendation', body, { signal });

export const generateRecipe = (
  body: {
    inventory: InventoryPayload[];
    servings?: number;
    language?: string;
    dietary_preferences?: string[];
    selected_item_ids?: string[];
  },
  signal?: AbortSignal,
) => apiPost<RecipeResponseWire>('/recipes/generate', body, { signal });

export const askAssistant = (
  body: {
    message: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    context?: {
      current_food?: string | null;
      current_status?: FoodStatus | null;
      current_score?: number | null;
      inventory?: InventoryPayload[];
      language?: string;
    };
  },
  signal?: AbortSignal,
) => apiPost<AssistantResponseWire>('/assistant/chat', body, { signal });

export const listKnownFoods = (signal?: AbortSignal) =>
  apiGet<{ foods: string[]; count: number; pantry: string[] }>('/knowledge/foods', {
    signal,
  });

// --- Adapters ------------------------------------------------------------

/**
 * Turns an /analyze response into the local AnalysisResult shape.
 *
 * The `id` and `analyzed_at` fields are client-side: the server does not
 * persist scans (inventory and history live in the user's own store), so the
 * app assigns them when it saves the result.
 */
export function toAnalysisResult(wire: AnalyzeResponse, id: string): AnalysisResult {
  return {
    id,
    food_name: wire.food_name,
    category: wire.category,
    status: wire.status,
    score: wire.score,
    confidence: wire.confidence,
    estimated_window: wire.estimated_window,
    visual_metrics: wire.visual_metrics,
    visual_narrative: wire.visual_narrative,
    storage_recommendation: wire.storage_recommendation,
    reasoning: wire.reasoning,
    safety_notice: wire.safety_notice,
    alternatives: wire.alternatives,
    processing_ms: wire.processing_ms,
    model_version: wire.model_version,
    analyzed_at: new Date().toISOString(),
  };
}

/** Narrows an inventory item to just what the AI endpoints need. */
export function toInventoryPayload(item: {
  id: string;
  food_name: string;
  category: FoodCategory;
  status: FoodStatus;
  estimated_remaining_days: number | null;
  quantity: number;
  unit: string;
}): InventoryPayload {
  return {
    id: item.id,
    food_name: item.food_name,
    category: item.category,
    status: item.status,
    estimated_remaining_days: item.estimated_remaining_days,
    quantity: item.quantity,
    unit: item.unit,
  };
}
