-- ===========================================================================
-- Structra :: 00700 - User settings
--
--   user_settings   1:1 with auth.users, holds per-user preferences
--
-- Reconciliation with the existing Structra store:
--
-- The Zustand store currently persists `theme` inside the items payload and
-- carries no other preferences. Moving theme here (a) makes it survive a
-- cleared localStorage and (b) makes it available server-side, so a later
-- server-rendered render can honour it without a flash of the wrong theme.
--
-- `app_theme` is an enum constrained to exactly the three values Structra's
-- ThemeVariant already uses, so an unsupported theme cannot be persisted.
--
-- Timezone is intentionally NOT duplicated here: it already lives on profiles
-- and duplicating it would create two sources of truth for one fact.
-- ---------------------------------------------------------------------------

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,

  theme public.app_theme not null default 'ocean',

  -- Sparse preference bag for app-level flags that do not justify a column each
  -- and are not yet implemented. NULL means "no overrides".
  preferences jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_settings_preferences_is_object
    check (preferences is null or jsonb_typeof(preferences) = 'object')
);

comment on table public.user_settings is
  'Per-user preferences, 1:1 with auth.users. Timezone lives on profiles to avoid duplication.';

drop trigger if exists user_settings_set_updated_at on public.user_settings;
  create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();