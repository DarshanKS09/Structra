-- ===========================================================================
-- Structra :: 01200 - Profile avatar uploads (Supabase Storage)
--
-- Purpose
--   Adds a bucket for user-uploaded profile photos. Without it the only way to
--   persist an avatar is to inline the image itself into `profiles.avatar_url`.
--   A base64 data URI for even a modest photo runs to several hundred kilobytes,
--   which bloats the profiles table, is duplicated into every query that selects
--   the row (including the workspace-member roster), and would eventually exceed
--   the column's practical limits.
--
--   So uploads go to Storage and `profiles.avatar_url` holds only the resulting
--   object URL - the column keeps its original meaning and stays small.
--
-- Object layout
--   Every object lives at `<user_id>/<unique-file-id>.<ext>`. The user id is the
--   first path segment, which makes "is this object yours?" answerable from the
--   path alone, with no lookup.
--
--   The filename is NOT fixed at `avatar.<ext>`. It used to be, and that made a
--   photo replaceable exactly once: `createSignedUploadUrl` will not mint a token
--   for an object that already exists, so the first upload succeeded and every
--   later one failed with "Could not prepare the upload." A unique name per upload
--   removes the collision, and because the stored URL then always changes, a
--   replacement can never be masked by the browser serving the previous image.
--
--   The trade-off is that a superseded object survives until the caller removes
--   it. `confirmUpload` in `components/ProfileMenu.tsx` does that only AFTER the
--   profile row points at the new object, so a failure at any earlier step leaves
--   the user with the photo they already had.
--
-- Security model
--   * Writes are strictly owner-only. Every write policy requires the first path
--     segment to equal `auth.uid()`, enforced in Postgres rather than trusted to
--     the client, so a user cannot upload into another user's folder even by
--     crafting the path directly.
--   * The bucket is PUBLIC READ. Profile photos are displayed across the app
--     (own header, workspace member roster), and a private bucket would force
--     short-lived signed URLs into `profiles.avatar_url`, which would silently
--     break every avatar some hours after it was saved. Reads being public is
--     deliberate and matches how profile images work elsewhere; the security
--     boundary that matters is who can WRITE, and that is owner-only.
--     To make reads private later, flip `public` to false in the update below and
--     switch the app to `createSignedUrl`; no other change would be required.
--   * Object size and MIME type are constrained on the bucket as well as in the
--     browser. The client-side checks are a courtesy that gives a fast,
--     understandable error; these are the checks that actually hold, because a
--     client-side check can be bypassed by anyone calling the API directly.
--
-- Validation rationale
--   2 MB is generous for a profile photo that will be rendered at 40-48 px, and
--   small enough that the bucket cannot be filled with video files. SVG is
--   excluded on purpose: it is an XML document that can carry script, and
--   serving it from the app's own origin would be a stored-XSS vector.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Bucket description: user profile photos. Objects are stored at
-- <user_id>/<unique-file-id>.<ext>; writes are restricted to the owning user.
--
-- This was previously written as `comment on bucket 'avatars' is '...'`, which is
-- not valid PostgreSQL - there is no `COMMENT ON BUCKET` statement, because a
-- storage bucket is a row in `storage.buckets`, not a SQL object that can carry a
-- comment. It failed the whole migration with `syntax error at or near "bucket"`.
-- The intent is preserved here as a plain comment, which is where a reader will
-- actually look for it anyway.

-- ---------------------------------------------------------------------------
-- Row level security on storage.objects
--
-- These policies are scoped to the bucket by name so they cannot affect any
-- other bucket added later.
-- ---------------------------------------------------------------------------

-- SELECT: open to everyone. See the security note above - this is intentional.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read
  on storage.objects for select
  using (bucket_id = 'avatars');

-- INSERT: only into your own folder.
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: only within your own folder.
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: only within your own folder.
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );