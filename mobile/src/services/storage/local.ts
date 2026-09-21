import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  AnalysisResult,
  AppNotification,
  FoodScan,
  InventoryItem,
  Recipe,
  UserPreferences,
  UserProfile,
} from '../../types';
import { DEFAULT_PREFERENCES, type FoodStore } from './types';

/**
 * On-device store, backed by AsyncStorage.
 *
 * This is the default, so Fresora is fully usable with zero credentials. Each
 * collection is one JSON blob under its own key -- at household inventory sizes
 * (tens to low hundreds of rows) reading and rewriting a whole collection is
 * far simpler than maintaining an index, and stays well inside AsyncStorage's
 * per-key limits.
 *
 * ponytail: whole-collection read/write. If someone accumulates thousands of
 * scans this becomes the bottleneck; move to expo-sqlite at that point, behind
 * this same FoodStore interface.
 */

const KEYS = {
  inventory: 'fresora.inventory.v1',
  scans: 'fresora.scans.v1',
  recipes: 'fresora.recipes.v1',
  notifications: 'fresora.notifications.v1',
  preferences: 'fresora.preferences.v1',
  profile: 'fresora.profile.v1',
  shopping: 'fresora.shopping.v1',
} as const;

/**
 * Collision-resistant id without pulling in a uuid dependency.
 * `Math.random` is fine here: these ids are local row keys, never secrets.
 */
const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const nowIso = (): string => new Date().toISOString();

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt or unreadable value: fall back rather than crashing the screen.
    // Storage can legitimately fail (cleared data, private mode, full disk).
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export class LocalFoodStore implements FoodStore {
  readonly kind = 'local' as const;

  // --- Inventory ------------------------------------------------------

  async listInventory(): Promise<InventoryItem[]> {
    const items = await readJson<InventoryItem[]>(KEYS.inventory, []);
    // Unresolved first, then most recently updated.
    return items.sort((a, b) => {
      if (!a.resolved_at && b.resolved_at) return -1;
      if (a.resolved_at && !b.resolved_at) return 1;
      return b.updated_at.localeCompare(a.updated_at);
    });
  }

  async getInventoryItem(id: string): Promise<InventoryItem | null> {
    const items = await readJson<InventoryItem[]>(KEYS.inventory, []);
    return items.find((item) => item.id === id) ?? null;
  }

  async addInventoryItem(
    item: Omit<InventoryItem, 'id' | 'created_at' | 'updated_at' | 'user_id'>,
  ): Promise<InventoryItem> {
    const items = await readJson<InventoryItem[]>(KEYS.inventory, []);
    const created: InventoryItem = {
      ...item,
      id: newId(),
      user_id: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await writeJson(KEYS.inventory, [created, ...items]);
    return created;
  }

  async updateInventoryItem(
    id: string,
    patch: Partial<InventoryItem>,
  ): Promise<InventoryItem> {
    const items = await readJson<InventoryItem[]>(KEYS.inventory, []);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`inventory item ${id} not found`);

    const updated: InventoryItem = {
      ...items[index],
      ...patch,
      id,
      updated_at: nowIso(),
    };
    items[index] = updated;
    await writeJson(KEYS.inventory, items);
    return updated;
  }

  async deleteInventoryItem(id: string): Promise<void> {
    const items = await readJson<InventoryItem[]>(KEYS.inventory, []);
    await writeJson(
      KEYS.inventory,
      items.filter((item) => item.id !== id),
    );
  }

  async resolveInventoryItem(
    id: string,
    resolution: 'consumed' | 'discarded',
  ): Promise<InventoryItem> {
    return this.updateInventoryItem(id, {
      resolution,
      resolved_at: nowIso(),
    });
  }

  // --- Scans ----------------------------------------------------------

  async listScans(): Promise<FoodScan[]> {
    const scans = await readJson<FoodScan[]>(KEYS.scans, []);
    return scans.sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
  }

  async addScan(
    scan: Omit<FoodScan, 'id' | 'user_id'> & { analysis: AnalysisResult | null },
  ): Promise<FoodScan> {
    const scans = await readJson<FoodScan[]>(KEYS.scans, []);
    const created: FoodScan = { ...scan, id: newId(), user_id: null };
    await writeJson(KEYS.scans, [created, ...scans]);
    return created;
  }

  async deleteScan(id: string): Promise<void> {
    const scans = await readJson<FoodScan[]>(KEYS.scans, []);
    await writeJson(
      KEYS.scans,
      scans.filter((scan) => scan.id !== id),
    );
  }

  async clearScans(): Promise<void> {
    await writeJson(KEYS.scans, []);
  }

  async listScansForItem(inventoryItemId: string): Promise<FoodScan[]> {
    const scans = await readJson<FoodScan[]>(KEYS.scans, []);
    return scans
      .filter((scan) => scan.inventory_item_id === inventoryItemId)
      // Oldest first: a journey reads forwards in time.
      .sort((a, b) => a.scanned_at.localeCompare(b.scanned_at));
  }

  // --- Recipes --------------------------------------------------------

  async listRecipes(): Promise<Recipe[]> {
    const recipes = await readJson<Recipe[]>(KEYS.recipes, []);
    return recipes.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async addRecipe(recipe: Omit<Recipe, 'id' | 'user_id' | 'created_at'>): Promise<Recipe> {
    const recipes = await readJson<Recipe[]>(KEYS.recipes, []);
    const created: Recipe = {
      ...recipe,
      id: newId(),
      user_id: null,
      created_at: nowIso(),
    };
    await writeJson(KEYS.recipes, [created, ...recipes]);
    return created;
  }

  async updateRecipe(id: string, patch: Partial<Recipe>): Promise<Recipe> {
    const recipes = await readJson<Recipe[]>(KEYS.recipes, []);
    const index = recipes.findIndex((recipe) => recipe.id === id);
    if (index === -1) throw new Error(`recipe ${id} not found`);

    const updated: Recipe = { ...recipes[index], ...patch, id };
    recipes[index] = updated;
    await writeJson(KEYS.recipes, recipes);
    return updated;
  }

  async deleteRecipe(id: string): Promise<void> {
    const recipes = await readJson<Recipe[]>(KEYS.recipes, []);
    await writeJson(
      KEYS.recipes,
      recipes.filter((recipe) => recipe.id !== id),
    );
  }

  // --- Notifications --------------------------------------------------

  async listNotifications(): Promise<AppNotification[]> {
    const items = await readJson<AppNotification[]>(KEYS.notifications, []);
    return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async addNotification(
    notification: Omit<AppNotification, 'id' | 'user_id' | 'created_at'>,
  ): Promise<AppNotification> {
    const items = await readJson<AppNotification[]>(KEYS.notifications, []);
    const created: AppNotification = {
      ...notification,
      id: newId(),
      user_id: null,
      created_at: nowIso(),
    };
    // Keep the list bounded; nobody scrolls past 50 reminders.
    await writeJson(KEYS.notifications, [created, ...items].slice(0, 50));
    return created;
  }

  async markNotificationRead(id: string): Promise<void> {
    const items = await readJson<AppNotification[]>(KEYS.notifications, []);
    await writeJson(
      KEYS.notifications,
      items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
  }

  async markAllNotificationsRead(): Promise<void> {
    const items = await readJson<AppNotification[]>(KEYS.notifications, []);
    await writeJson(
      KEYS.notifications,
      items.map((item) => ({ ...item, read: true })),
    );
  }

  // --- Preferences and profile ----------------------------------------

  async getPreferences(): Promise<UserPreferences> {
    const stored = await readJson<Partial<UserPreferences>>(KEYS.preferences, {});
    // Spread over the defaults so a preference added in a later release does
    // not come back undefined for existing installs.
    return { ...DEFAULT_PREFERENCES, ...stored };
  }

  async savePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = await this.getPreferences();
    const next = { ...current, ...patch };
    await writeJson(KEYS.preferences, next);
    return next;
  }

  async getProfile(): Promise<UserProfile | null> {
    return readJson<UserProfile | null>(KEYS.profile, null);
  }

  async saveProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
    const current = await this.getProfile();
    const next: UserProfile = {
      id: current?.id ?? 'local-user',
      full_name: null,
      email: null,
      avatar_url: null,
      created_at: current?.created_at ?? nowIso(),
      ...current,
      ...patch,
    };
    await writeJson(KEYS.profile, next);
    return next;
  }

  // --- Shopping list --------------------------------------------------

  async getShoppingList(): Promise<string[]> {
    return readJson<string[]>(KEYS.shopping, []);
  }

  async saveShoppingList(items: string[]): Promise<void> {
    await writeJson(KEYS.shopping, items);
  }

  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  }
}
