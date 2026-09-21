import type {
  AnalysisResult,
  AppNotification,
  FoodScan,
  InventoryItem,
  Recipe,
  UserPreferences,
  UserProfile,
} from '../../types';
import { getSupabase } from '../supabase';
import { DEFAULT_PREFERENCES, type FoodStore } from './types';

/**
 * Supabase-backed store.
 *
 * Every table is protected by row-level security (see
 * `supabase/migrations/0001_init.sql`), so these queries never filter by
 * `user_id` themselves -- Postgres does it, and a bug here cannot leak another
 * user's rows. `user_id` is still written on insert because the RLS policies
 * check it against `auth.uid()`.
 *
 * Analysis payloads are stored as JSONB rather than spread across columns: the
 * shape is owned by the backend's response model, and the app only ever reads
 * it back whole.
 */
export class SupabaseFoodStore implements FoodStore {
  readonly kind = 'supabase' as const;

  private async userId(): Promise<string> {
    const { data, error } = await getSupabase().auth.getUser();
    if (error || !data.user) {
      throw new Error('Not signed in');
    }
    return data.user.id;
  }

  private get db() {
    return getSupabase();
  }

  // --- Inventory ------------------------------------------------------

  async listInventory(): Promise<InventoryItem[]> {
    const { data, error } = await this.db
      .from('food_inventory')
      .select('*')
      .order('resolved_at', { ascending: true, nullsFirst: true })
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as InventoryItem[];
  }

  async getInventoryItem(id: string): Promise<InventoryItem | null> {
    const { data, error } = await this.db
      .from('food_inventory')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return (data as InventoryItem | null) ?? null;
  }

  async addInventoryItem(
    item: Omit<InventoryItem, 'id' | 'created_at' | 'updated_at' | 'user_id'>,
  ): Promise<InventoryItem> {
    const { data, error } = await this.db
      .from('food_inventory')
      .insert({ ...item, user_id: await this.userId() })
      .select()
      .single();

    if (error) throw error;
    return data as InventoryItem;
  }

  async updateInventoryItem(
    id: string,
    patch: Partial<InventoryItem>,
  ): Promise<InventoryItem> {
    const { data, error } = await this.db
      .from('food_inventory')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as InventoryItem;
  }

  async deleteInventoryItem(id: string): Promise<void> {
    const { error } = await this.db.from('food_inventory').delete().eq('id', id);
    if (error) throw error;
  }

  async resolveInventoryItem(
    id: string,
    resolution: 'consumed' | 'discarded',
  ): Promise<InventoryItem> {
    return this.updateInventoryItem(id, {
      resolution,
      resolved_at: new Date().toISOString(),
    });
  }

  // --- Scans ----------------------------------------------------------

  async listScans(): Promise<FoodScan[]> {
    const { data, error } = await this.db
      .from('food_scans')
      .select('*')
      .order('scanned_at', { ascending: false })
      .limit(300);

    if (error) throw error;
    return (data ?? []) as FoodScan[];
  }

  async addScan(
    scan: Omit<FoodScan, 'id' | 'user_id'> & { analysis: AnalysisResult | null },
  ): Promise<FoodScan> {
    const { data, error } = await this.db
      .from('food_scans')
      .insert({ ...scan, user_id: await this.userId() })
      .select()
      .single();

    if (error) throw error;
    return data as FoodScan;
  }

  async deleteScan(id: string): Promise<void> {
    const { error } = await this.db.from('food_scans').delete().eq('id', id);
    if (error) throw error;
  }

  async clearScans(): Promise<void> {
    // RLS scopes the delete to the caller's own rows, so an unfiltered delete
    // here cannot touch anyone else's history. The `neq` is required because
    // Supabase refuses a delete with no filter at all.
    const { error } = await this.db
      .from('food_scans')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
  }

  async listScansForItem(inventoryItemId: string): Promise<FoodScan[]> {
    const { data, error } = await this.db
      .from('food_scans')
      .select('*')
      .eq('inventory_item_id', inventoryItemId)
      .order('scanned_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as FoodScan[];
  }

  // --- Recipes --------------------------------------------------------

  async listRecipes(): Promise<Recipe[]> {
    const { data, error } = await this.db
      .from('recipes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as Recipe[];
  }

  async addRecipe(recipe: Omit<Recipe, 'id' | 'user_id' | 'created_at'>): Promise<Recipe> {
    const { data, error } = await this.db
      .from('recipes')
      .insert({ ...recipe, user_id: await this.userId() })
      .select()
      .single();

    if (error) throw error;
    return data as Recipe;
  }

  async updateRecipe(id: string, patch: Partial<Recipe>): Promise<Recipe> {
    const { data, error } = await this.db
      .from('recipes')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Recipe;
  }

  async deleteRecipe(id: string): Promise<void> {
    const { error } = await this.db.from('recipes').delete().eq('id', id);
    if (error) throw error;
  }

  // --- Notifications --------------------------------------------------

  async listNotifications(): Promise<AppNotification[]> {
    const { data, error } = await this.db
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return (data ?? []) as AppNotification[];
  }

  async addNotification(
    notification: Omit<AppNotification, 'id' | 'user_id' | 'created_at'>,
  ): Promise<AppNotification> {
    const { data, error } = await this.db
      .from('notifications')
      .insert({ ...notification, user_id: await this.userId() })
      .select()
      .single();

    if (error) throw error;
    return data as AppNotification;
  }

  async markNotificationRead(id: string): Promise<void> {
    const { error } = await this.db
      .from('notifications')
      .update({ read: true })
      .eq('id', id);
    if (error) throw error;
  }

  async markAllNotificationsRead(): Promise<void> {
    const { error } = await this.db
      .from('notifications')
      .update({ read: true })
      .eq('read', false);
    if (error) throw error;
  }

  // --- Preferences and profile ----------------------------------------

  async getPreferences(): Promise<UserPreferences> {
    const { data, error } = await this.db
      .from('user_preferences')
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ...DEFAULT_PREFERENCES };

    return {
      language: data.language ?? DEFAULT_PREFERENCES.language,
      notifications_enabled:
        data.notifications_enabled ?? DEFAULT_PREFERENCES.notifications_enabled,
      expiry_reminders: data.expiry_reminders ?? DEFAULT_PREFERENCES.expiry_reminders,
      rescue_suggestions:
        data.rescue_suggestions ?? DEFAULT_PREFERENCES.rescue_suggestions,
      default_category: data.default_category ?? DEFAULT_PREFERENCES.default_category,
      default_storage: data.default_storage ?? DEFAULT_PREFERENCES.default_storage,
      dietary_preferences:
        data.dietary_preferences ?? DEFAULT_PREFERENCES.dietary_preferences,
    };
  }

  async savePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = await this.getPreferences();
    const next = { ...current, ...patch };

    const { error } = await this.db.from('user_preferences').upsert(
      { ...next, user_id: await this.userId(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );

    if (error) throw error;
    return next;
  }

  async getProfile(): Promise<UserProfile | null> {
    const { data, error } = await this.db.from('profiles').select('*').maybeSingle();
    if (error) throw error;
    return (data as UserProfile | null) ?? null;
  }

  async saveProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
    const id = await this.userId();
    const { data, error } = await this.db
      .from('profiles')
      .upsert({ ...patch, id, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;
    return data as UserProfile;
  }

  // --- Shopping list --------------------------------------------------

  async getShoppingList(): Promise<string[]> {
    const { data, error } = await this.db
      .from('user_preferences')
      .select('shopping_list')
      .maybeSingle();

    if (error) throw error;
    return (data?.shopping_list as string[] | null) ?? [];
  }

  async saveShoppingList(items: string[]): Promise<void> {
    const { error } = await this.db.from('user_preferences').upsert(
      {
        user_id: await this.userId(),
        shopping_list: items,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
  }

  async clearAll(): Promise<void> {
    // Order matters: food_scans references food_inventory.
    const sentinel = '00000000-0000-0000-0000-000000000000';
    for (const table of [
      'food_scans',
      'recipes',
      'notifications',
      'food_inventory',
      'user_preferences',
    ]) {
      const { error } = await this.db.from(table).delete().neq('id', sentinel);
      // A missing table should not abort the wipe of the others.
      if (error && error.code !== '42P01') throw error;
    }
  }
}
