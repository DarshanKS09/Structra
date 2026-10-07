-- ===========================================================================
-- Structra :: 01100 - OTP challenges (registration email verification)
--
-- Purpose
--   Structra verifies a new registrant's email address with a 6-digit one-time
--   code before creating the Supabase Auth account. The code itself is never
--   stored: only a keyed HMAC digest is, and only the server holds the key.
--
-- Why a separate table rather than an existing one
--   OTP challenges are transient security artefacts, not user application data.
--   Keeping them apart means they cannot be swept up by a workspace delete, do
--   not appear in any user-facing query, and can be expired/audited on their own
--   schedule.
--
-- Security model
--   * RLS is enabled with NO policies at all, so `anon` and `authenticated`
--     cannot read or write a single row. Only the service role (which bypasses
--     RLS) and the server-side API routes can touch this table.
--   * Grants are explicitly revoked from the client roles as defence in depth,
--     on top of RLS.
--   * `code_digest` is HMAC-SHA256 with a server-side pepper. A bare hash of a
--     6-digit code is trivially brute-forced (only 1,000,000 possibilities),
--     which is exactly why the pepper is mandatory rather than optional.
-- ===========================================================================

-- Only the narrow purpose currently in use. Keeps the table honest if another
-- flow (password reset, email change) is added later.
--
-- Guarded so the migration can be re-applied after a partial failure, matching
-- the treatment of every other enum in 00000.
do $$ begin
  create type public.otp_purpose as enum ('registration');
exception
  when duplicate_object then null;
end $$;


create table if not exists public.otp_challenges (
  id uuid primary key default gen_random_uuid(),

  -- Lower-cased and trimmed at write time so lookups are case-insensitive and a
  -- caller cannot dodge an existing challenge by changing capitalisation.
  email text not null,

  purpose public.otp_purpose not null default 'registration',

  -- HMAC-SHA256(pepper, purpose || email || code). 32 bytes. Never the code.
  code_digest bytea not null,

  attempts smallint not null default 0,
  max_attempts smallint not null default 5,

  -- Ten-minute window, enforced by the application and re-checked here so a
  -- caller cannot insert a challenge that is already stale.
  expires_at timestamptz not null,

  -- Set once the code has been proven correct. From here the user may create a
  -- password, but only by presenting the signed token minted at that moment.
  verified_at timestamptz,

  -- Set when the challenge is spent (account created) or when a new code
  -- supersedes it. A consumed challenge can never be reused.
  consumed_at timestamptz,

  -- Client IP, retained only for rate limiting. Not exposed in any response.
  request_ip text,

  created_at timestamptz not null default now(),

  constraint otp_challenges_attempts_bounded
    check (attempts >= 0 and attempts <= max_attempts),

  constraint otp_challenges_expiry_sane
    check (expires_at > created_at)

  -- Deliberately no "consumed implies verified" constraint. A challenge is
  -- consumed for three legitimate reasons: the account was created, it was
  -- superseded by a newly requested code, or it expired/was exhausted. Only the
  -- first requires prior verification, so such a constraint would reject the
  -- normal resend path.
);

comment on table public.otp_challenges is
  'Registration OTP challenges. Stores only a peppered HMAC of the code. No RLS policies exist, so client roles cannot read or write it.';

-- At most one live challenge per (email, purpose). This is the database-level
-- guarantee behind "requesting a new OTP invalidates the previous one": the
-- application supersedes the old row, and the index makes a duplicate
-- impossible even under concurrent requests.
create unique index if not exists otp_challenges_one_active
  on public.otp_challenges (email, purpose)
  where consumed_at is null;

-- Rate limiting: "how many codes have we sent to this address recently?"
-- (a resend creates a new row and supersedes the old one, so `created_at` is the
--  send time and no separate `last_sent_at` is needed)
create index if not exists otp_challenges_email_created_idx
  on public.otp_challenges (email, created_at desc);

-- Rate limiting by source address.
create index if not exists otp_challenges_ip_created_idx
  on public.otp_challenges (request_ip, created_at desc)
  where request_ip is not null;

-- Housekeeping: purge spent challenges so the table cannot grow without bound.
-- Retention is deliberately longer than the 10-minute TTL so that rate-limit
-- counting still has history to work with.
create index if not exists otp_challenges_consumed_idx
  on public.otp_challenges (consumed_at)
  where consumed_at is not null;


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Enabled with NO policies. This is intentional and is the strongest possible
-- posture: a table with RLS on and zero policies denies every access to
-- `anon` and `authenticated`, so no client-side query - however crafted -
-- can read a code digest, count challenges, or forge one.
--
-- The service role bypasses RLS, which is what allows the server-side
-- registration API routes to do their work.
-- ---------------------------------------------------------------------------
alter table public.otp_challenges enable row level security;
alter table public.otp_challenges force row level security;

-- Belt and braces: remove table privileges from the client roles entirely, so
-- the table is unreachable even if RLS were ever accidentally disabled.
--
-- No sequence is revoked because `id` defaults to `gen_random_uuid()`; this
-- table owns no sequence.
revoke all on table public.otp_challenges from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Cleanup helper
--
-- Deletes spent and long-expired challenges. Safe to call on a schedule; it is
-- idempotent and touches nothing that is still in play.
-- ---------------------------------------------------------------------------
create or replace function public.purge_spent_otp_challenges(older_than interval default interval '1 day')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
begin
  -- plpgsql rather than SQL: a data-modifying CTE is not permitted in a plain
  -- SQL function body.
  delete from public.otp_challenges
  where created_at < now() - older_than;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_spent_otp_challenges(interval) is
  'Deletes OTP challenges older than the given interval. Idempotent; intended for periodic invocation.';