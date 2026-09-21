import type {
  AnalysisResult,
  AppNotification,
  FoodScan,
  InventoryItem,
  Recipe,
  UserPreferences,
  UserProfile,
} from '../../types';

/**
 * The persistence contract.
 *
 * Two real implementations exist: `LocalFoodStore` (AsyncStorage, works with no
 * credentials) and `SupabaseFoodStore` (Postgres with row-level security). The
 * app picks one at start-up based on whether Supabase env vars are present, and
 * no screen knows which one it got.
 */
export interface FoodStore {
  /** Which backing store this is, for the settings screen to display. */
  readonly kind: 'local' | 'supabase';

  // --- Inventory ------------------------------------------------------
  listInventory(): Promise<InventoryItem[]>;
  getInventoryItem(id: string): Promise<InventoryItem | null>;
  addInventoryItem(
    item: Omit<InventoryItem, 'id' | 'created_at' | 'updated_at' | 'user_id'>,
  ): Promise<InventoryItem>;
  updateInventoryItem(id: string, patch: Partial<InventoryItem>): Promise<InventoryItem>;
  deleteInventoryItem(id: string): Promise<void>;
  /** Marks an item consumed or discarded; drives the rescue metrics. */
  resolveInventoryItem(id: string, resolution: 'consumed' | 'discarded'): Promise<InventoryItem>;

  // --- Scans ----------------------------------------------------------
  listScans(): Promise<FoodScan[]>;
  addScan(
    scan: Omit<FoodScan, 'id' | 'user_id'> & { analysis: AnalysisResult | null },
  ): Promise<FoodScan>;
  deleteScan(id: string): Promise<void>;
  clearScans(): Promise<void>;
  /** Every scan linked to one inventory item, oldest first: the journey. */
  listScansForItem(inventoryItemId: string): Promise<FoodScan[]>;

  // --- Recipes --------------------------------------------------------
  listRecipes(): Promise<Recipe[]>;
  addRecipe(recipe: Omit<Recipe, 'id' | 'user_id' | 'created_at'>): Promise<Recipe>;
  updateRecipe(id: string, patch: Partial<Recipe>): Promise<Recipe>;
  deleteRecipe(id: string): Promise<void>;

  // --- Notifications --------------------------------------------------
  listNotifications(): Promise<AppNotification[]>;
  addNotification(
    notification: Omit<AppNotification, 'id' | 'user_id' | 'created_at'>,
  ): Promise<AppNotification>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;

  // --- Preferences and profile ----------------------------------------
  getPreferences(): Promise<UserPreferences>;
  savePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences>;
  getProfile(): Promise<UserProfile | null>;
  saveProfile(patch: Partial<UserProfile>): Promise<UserProfile>;

  // --- Shopping list --------------------------------------------------
  getShoppingList(): Promise<string[]>;
  saveShoppingList(items: string[]): Promise<void>;

  /** Wipes everything this store owns. Used by "delete account and data". */
  clearAll(): Promise<void>;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  language: 'en',
  notifications_enabled: false,
  expiry_reminders: true,
  rescue_suggestions: true,
  default_category: 'auto',
  default_storage: 'refrigerated',
  dietary_preferences: [],
};
