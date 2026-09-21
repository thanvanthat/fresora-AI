-- =============================================================================
-- Fresora -- initial schema
-- =============================================================================
--
-- Apply with either:
--   supabase db push                        (Supabase CLI, linked project)
--   or paste into the SQL editor in the Supabase dashboard
--
-- Every table is owned by a user and protected by row-level security. The
-- mobile app talks to these tables directly with the anon key, so RLS is the
-- only thing standing between one user's food and another's -- the client is
-- never trusted to filter by user_id itself.
--
-- SCOPE NOTE
-- ----------
-- This creates exactly the tables the app reads and writes:
--   profiles, food_inventory, food_scans, recipes, notifications,
--   user_preferences
--
-- The original design also sketched `food_items`, `food_analysis` and
-- `recipe_ingredients`. They are deliberately NOT created:
--
--   * food_items would be a normalised food catalogue, but the canonical food
--     list lives in the backend's curated knowledge base
--     (backend/app/knowledge/food_data.py) and is served from
--     GET /api/v1/knowledge/foods. A second copy in Postgres would drift.
--   * food_analysis / recipe_ingredients would normalise data the app only
--     ever reads back whole, alongside its parent row. They are stored as
--     JSONB columns instead (food_scans.analysis, recipes.ingredients), which
--     is one round trip instead of a join and keeps the shape owned by the
--     backend response model.
--
-- Add them when something actually needs to query across analyses or search by
-- ingredient. Until then they would be empty tables.

-- =============================================================================
-- Extensions
-- =============================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- =============================================================================
-- Enums
-- =============================================================================
-- Mirrors mobile/src/types/food.ts and backend/app/schemas.py. Enums rather
-- than free text so a typo fails at write time instead of quietly creating a
-- status nothing renders.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'food_status') then
    create type food_status as enum ('fresh', 'nearly_spoiled', 'overripe', 'spoiled');
  end if;

  if not exists (select 1 from pg_type where typname = 'food_category') then
    create type food_category as enum (
      'fruit', 'vegetable', 'meat', 'poultry', 'seafood', 'dairy', 'bakery', 'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'storage_type') then
    create type storage_type as enum ('pantry', 'refrigerated', 'frozen', 'counter');
  end if;

  if not exists (select 1 from pg_type where typname = 'item_resolution') then
    create type item_resolution as enum ('consumed', 'discarded');
  end if;

  if not exists (select 1 from pg_type where typname = 'item_source') then
    create type item_source as enum ('scan', 'manual', 'barcode', 'receipt');
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type notification_type as enum ('expiry', 'rescue', 'priority', 'system');
  end if;

  if not exists (select 1 from pg_type where typname = 'recipe_source') then
    create type recipe_source as enum ('llm', 'rules');
  end if;
end$$;

-- =============================================================================
-- Shared trigger: keep updated_at honest
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- profiles
-- =============================================================================
-- One row per auth user. `id` IS the auth.users id, so a profile cannot exist
-- without an account and is removed with it.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  avatar_url  text,
  language    text not null default 'en',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Creates the profile row on sign-up, so the app never has to special-case a
-- signed-in user with no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- food_inventory
-- =============================================================================
-- The user's kitchen. A row stays after it is consumed or discarded
-- (resolved_at / resolution) because the analytics screen measures exactly
-- that: what was used in time versus what was thrown away.

create table if not exists public.food_inventory (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users (id) on delete cascade,
  food_name                 text not null check (length(trim(food_name)) > 0),
  category                  food_category not null default 'other',
  status                    food_status not null default 'fresh',
  -- Null for a manually added item: nothing was measured, so there is no score.
  score                     integer check (score is null or (score between 0 and 100)),
  quantity                  numeric(10, 2) not null default 1 check (quantity >= 0),
  unit                      text not null default 'item',
  image_uri                 text,
  storage_type              storage_type not null default 'refrigerated',
  purchase_date             timestamptz,
  best_before_date          date,
  estimated_remaining_days  integer check (
                              estimated_remaining_days is null
                              or estimated_remaining_days >= 0
                            ),
  -- When estimated_remaining_days was set. The app ages the estimate forward
  -- from here, so an item does not claim "4 days" indefinitely.
  assessed_at               timestamptz not null default now(),
  resolved_at               timestamptz,
  resolution                item_resolution,
  source                    item_source not null default 'scan',
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Both or neither: a resolved item must say how it was resolved.
  constraint resolution_is_complete check (
    (resolved_at is null and resolution is null)
    or (resolved_at is not null and resolution is not null)
  )
);

drop trigger if exists food_inventory_set_updated_at on public.food_inventory;
create trigger food_inventory_set_updated_at
  before update on public.food_inventory
  for each row execute function public.set_updated_at();

-- The inventory list is always "my active items, most recently updated".
create index if not exists food_inventory_active_idx
  on public.food_inventory (user_id, updated_at desc)
  where resolved_at is null;

-- Analytics reads resolved rows by date.
create index if not exists food_inventory_resolved_idx
  on public.food_inventory (user_id, resolved_at desc)
  where resolved_at is not null;

-- =============================================================================
-- food_scans
-- =============================================================================
-- One row per analysis. Linked to an inventory item so repeat scans of the
-- same physical item form its freshness journey.

create table if not exists public.food_scans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  food_name          text not null,
  category           food_category not null default 'other',
  status             food_status not null,
  score              integer not null check (score between 0 and 100),
  confidence         numeric(5, 4) not null default 0 check (confidence between 0 and 1),
  image_uri          text,
  -- The full analysis response. JSONB because the shape is owned by the
  -- backend's AnalysisResponse model and is only ever read back whole.
  analysis           jsonb,
  -- Set null rather than cascading: deleting an item should not erase the
  -- history of having scanned it.
  inventory_item_id  uuid references public.food_inventory (id) on delete set null,
  scanned_at         timestamptz not null default now()
);

create index if not exists food_scans_user_idx
  on public.food_scans (user_id, scanned_at desc);

-- The freshness-journey query.
create index if not exists food_scans_journey_idx
  on public.food_scans (inventory_item_id, scanned_at asc)
  where inventory_item_id is not null;

-- =============================================================================
-- recipes
-- =============================================================================

create table if not exists public.recipes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  title             text not null check (length(trim(title)) > 0),
  description       text not null default '',
  prep_minutes      integer not null default 0 check (prep_minutes >= 0),
  cook_minutes      integer not null default 0 check (cook_minutes >= 0),
  servings          integer not null default 2 check (servings > 0),
  -- [{ ingredient_name, quantity, is_rescued, inventory_item_id }]
  ingredients       jsonb not null default '[]'::jsonb,
  instructions      jsonb not null default '[]'::jsonb,
  -- Inventory ids this recipe puts to use. Drives the "N rescued" badge and
  -- the "I cooked this" action.
  rescued_item_ids  jsonb not null default '[]'::jsonb,
  tips              jsonb not null default '[]'::jsonb,
  saved             boolean not null default true,
  source            recipe_source not null default 'rules',
  created_at        timestamptz not null default now(),

  constraint ingredients_is_array  check (jsonb_typeof(ingredients) = 'array'),
  constraint instructions_is_array check (jsonb_typeof(instructions) = 'array')
);

create index if not exists recipes_user_idx
  on public.recipes (user_id, created_at desc);

-- =============================================================================
-- notifications
-- =============================================================================
-- The app's own record of what it flagged, separate from the OS tray, so a
-- dismissed banner does not lose the reminder.

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  message       text not null default '',
  type          notification_type not null default 'system',
  read          boolean not null default false,
  -- Deep link, e.g. '/inventory'.
  action_route  text,
  created_at    timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications (user_id)
  where read = false;

-- =============================================================================
-- user_preferences
-- =============================================================================
-- One row per user (enforced by the unique constraint, which the app's upsert
-- targets via on_conflict=user_id).

create table if not exists public.user_preferences (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users (id) on delete cascade,
  language             text not null default 'en',
  notifications_enabled boolean not null default false,
  expiry_reminders     boolean not null default true,
  rescue_suggestions   boolean not null default true,
  default_category     text not null default 'auto',
  default_storage      storage_type not null default 'refrigerated',
  dietary_preferences  jsonb not null default '[]'::jsonb,
  shopping_list        jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-level security
-- =============================================================================
-- Enabled on every table, with no permissive fallback. A user sees only rows
-- where user_id = auth.uid(); `profiles` keys on id instead, because there the
-- primary key IS the user id.
--
-- The WITH CHECK clause on insert/update is what stops a client from writing a
-- row belonging to someone else -- without it, RLS would filter reads but
-- allow a forged user_id on write.

alter table public.profiles          enable row level security;
alter table public.food_inventory    enable row level security;
alter table public.food_scans        enable row level security;
alter table public.recipes           enable row level security;
alter table public.notifications     enable row level security;
alter table public.user_preferences  enable row level security;

-- --- profiles ---------------------------------------------------------------

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles: delete own" on public.profiles;
create policy "profiles: delete own" on public.profiles
  for delete using (auth.uid() = id);

-- --- food_inventory ---------------------------------------------------------

drop policy if exists "inventory: read own" on public.food_inventory;
create policy "inventory: read own" on public.food_inventory
  for select using (auth.uid() = user_id);

drop policy if exists "inventory: insert own" on public.food_inventory;
create policy "inventory: insert own" on public.food_inventory
  for insert with check (auth.uid() = user_id);

drop policy if exists "inventory: update own" on public.food_inventory;
create policy "inventory: update own" on public.food_inventory
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "inventory: delete own" on public.food_inventory;
create policy "inventory: delete own" on public.food_inventory
  for delete using (auth.uid() = user_id);

-- --- food_scans -------------------------------------------------------------

drop policy if exists "scans: read own" on public.food_scans;
create policy "scans: read own" on public.food_scans
  for select using (auth.uid() = user_id);

drop policy if exists "scans: insert own" on public.food_scans;
create policy "scans: insert own" on public.food_scans
  for insert with check (auth.uid() = user_id);

drop policy if exists "scans: update own" on public.food_scans;
create policy "scans: update own" on public.food_scans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "scans: delete own" on public.food_scans;
create policy "scans: delete own" on public.food_scans
  for delete using (auth.uid() = user_id);

-- --- recipes ----------------------------------------------------------------

drop policy if exists "recipes: read own" on public.recipes;
create policy "recipes: read own" on public.recipes
  for select using (auth.uid() = user_id);

drop policy if exists "recipes: insert own" on public.recipes;
create policy "recipes: insert own" on public.recipes
  for insert with check (auth.uid() = user_id);

drop policy if exists "recipes: update own" on public.recipes;
create policy "recipes: update own" on public.recipes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "recipes: delete own" on public.recipes;
create policy "recipes: delete own" on public.recipes
  for delete using (auth.uid() = user_id);

-- --- notifications ----------------------------------------------------------

drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications: insert own" on public.notifications;
create policy "notifications: insert own" on public.notifications
  for insert with check (auth.uid() = user_id);

drop policy if exists "notifications: update own" on public.notifications;
create policy "notifications: update own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notifications: delete own" on public.notifications;
create policy "notifications: delete own" on public.notifications
  for delete using (auth.uid() = user_id);

-- --- user_preferences -------------------------------------------------------

drop policy if exists "preferences: read own" on public.user_preferences;
create policy "preferences: read own" on public.user_preferences
  for select using (auth.uid() = user_id);

drop policy if exists "preferences: insert own" on public.user_preferences;
create policy "preferences: insert own" on public.user_preferences
  for insert with check (auth.uid() = user_id);

drop policy if exists "preferences: update own" on public.user_preferences;
create policy "preferences: update own" on public.user_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "preferences: delete own" on public.user_preferences;
create policy "preferences: delete own" on public.user_preferences
  for delete using (auth.uid() = user_id);

-- =============================================================================
-- Storage bucket for food photos (optional)
-- =============================================================================
-- The app keeps photos on the device by default. Create this bucket only if you
-- want them synced across devices, then set image_uri to the object path.
--
-- Private, not public: a food photo can show a kitchen, and a public bucket
-- would make every object URL guessable.

insert into storage.buckets (id, name, public)
values ('food-images', 'food-images', false)
on conflict (id) do nothing;

-- Objects live under <user_id>/<filename>, so the first path segment is the
-- owner and that is what the policies check.

drop policy if exists "food images: read own" on storage.objects;
create policy "food images: read own" on storage.objects
  for select using (
    bucket_id = 'food-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "food images: upload own" on storage.objects;
create policy "food images: upload own" on storage.objects
  for insert with check (
    bucket_id = 'food-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "food images: delete own" on storage.objects;
create policy "food images: delete own" on storage.objects
  for delete using (
    bucket_id = 'food-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
