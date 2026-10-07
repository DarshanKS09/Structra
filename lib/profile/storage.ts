import { db } from "@/lib/data/client";
import { toDataError, DataError } from "@/lib/data/errors";

/**
 * Profile photo uploads.
 *
 * ---------------------------------------------------------------------------
 * WHY STORAGE RATHER THAN THE profiles TABLE
 * ---------------------------------------------------------------------------
 * `profiles.avatar_url` is a text column that is selected in every query that
 * reads a profile, including the workspace member roster. Inlining an uploaded
 * photo there as a data URI would put hundreds of kilobytes per user into each
 * of those responses, so the image is uploaded to Storage and only its URL is
 * stored.
 *
 * ---------------------------------------------------------------------------
 * HOW THE USER IS SCOPED
 * ---------------------------------------------------------------------------
 * The object path is `<user_id>/avatar.<ext>`, built here from the id the caller
 * passes in. That is a convenience for producing a tidy path, NOT the security
 * boundary: the database's storage policies re-derive ownership from
 * `auth.uid()` and the path prefix, so a caller who forged a different user id
 * would be rejected by RLS rather than being trusted. The service-role key is
 * never used and is not available on the client.
 *
 * Re-uploading overwrites the same object, so replacing a photo cannot orphan
 * the previous file.
 */

const BUCKET = "avatars";

/** 2 MB. Matches the bucket's `file_size_limit`, which is what actually holds. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Accepted types.
 *
 * Mirrors the bucket's `allowed_mime_types`. SVG is deliberately excluded: it is
 * an XML document that can carry script, and serving one from this app's own
 * origin would be a stored-XSS vector. The bucket enforces the same list, so
 * this is a fast local error rather than the actual boundary.
 */
export const ALLOWED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
] as const;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

/**
 * Turns a Storage API failure into something a user can act on.
 *
 * The case worth special-casing is a missing RLS policy: writes are scoped by
 * the policies in `20250101001200_profile_avatars.sql`, and if they have not
 * been applied the API answers "new row violates row-level security policy".
 * That is accurate but useless to a user, so it is translated into a message
 * that names the actual remedy.
 */
const toStorageError = (error: { message?: string } | null, fallback: string): DataError => {
  const message = error?.message ?? "";

  if (/row-level security|row level security/i.test(message)) {
    // The user-facing message stays non-technical, but the developer running
    // the deployment needs to know exactly which file to apply.
    if (typeof console !== "undefined") {
      console.warn(
        "[structra] Avatar upload was refused by Row Level Security. The storage " +
          "policies in supabase/migrations/20250101001200_profile_avatars.sql " +
          "must be applied to this project (dashboard SQL editor, or `supabase db push`). " +
          "The bucket itself may already exist; it is the policies on storage.objects " +
          "that are missing. Underlying error:",
        message
      );
    }
    return new DataError(
      "DATABASE",
      "Photo uploads are not enabled yet on this deployment. Please try again later."
    );
  }
  if (/exceeded the maximum allowed size/i.test(message)) {
    return new DataError("VALIDATION", "That image is too large. Please pick one under 2 MB.");
  }
  if (/mime type .* is not supported/i.test(message)) {
    return new DataError("VALIDATION", "Images only: JPEG, PNG, WebP or GIF.");
  }
  if (/exceeded the maximum allowed files|quota/i.test(message)) {
    return new DataError("DATABASE", "There is no storage space left for another photo.");
  }
  return toDataError(error, fallback);
};

/**
 * Validates a picked file before anything is uploaded.
 *
 * A rejected file costs nothing and produces a message the user can act on,
 * instead of a failed round trip with an opaque storage error.
 */
export const validateAvatarFile = (file: File): { ok: true } | { ok: false; message: string } => {
  const type = file.type?.toLowerCase()?.trim() ?? "";

  if (!type) {
    return { ok: false, message: "That file type could not be read. Try a JPEG, PNG, WebP or GIF." };
  }
  if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(type)) {
    return { ok: false, message: "Images only: JPEG, PNG, WebP or GIF." };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    const mb = (MAX_AVATAR_BYTES / (1024 * 1024)).toFixed(0);
    return { ok: false, message: `That image is too large. Please pick one under ${mb} MB.` };
  }
  if (file.size === 0) {
    return { ok: false, message: "That file appears to be empty." };
  }
  return { ok: true };
};

/**
 * The object path for a user's avatar.
 *
 * The user id is validated rather than interpolated blindly. In practice it is a
 * UUID taken from the authenticated session, so it can never contain a slash -
 * but this is the one place where a caller-supplied string becomes a storage
 * path, and a `../` reaching it would let an upload be addressed outside the
 * user's own folder. Rejecting it here is cheap; relying on that never happening
 * is not. The database policies remain the actual boundary.
 */
export const avatarPath = (userId: string, mimeType: string): string => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId) || userId === "." || userId === "..") {
    throw new DataError("VALIDATION", "Could not determine the account for this upload.");
  }
  const extension = EXTENSION_BY_TYPE[mimeType] ?? "bin";
  return `${userId}/avatar.${extension}`;
};

/**
 * Uploads a photo and returns the URL to persist in `profiles.avatar_url`.
 *
 * The previous file is removed first when it lived in this bucket, so switching
 * between formats does not leave the previous object behind.
 */
export const uploadAvatar = async (userId: string, file: File): Promise<string> => {
  const check = validateAvatarFile(file);
  if (!check.ok) throw new DataError("VALIDATION", check.message);

  const client = db();
  const storage = client.storage.from(BUCKET);
  const path = avatarPath(userId, file.type.toLowerCase().trim());

  // Best-effort cleanup of a differently-typed previous upload. Failure here is
  // not worth surfacing: the new upload is what the user asked for.
  const { data: existing } = await storage.list(userId, { limit: 100 });
  const stale = (existing ?? []).map((entry) => entry.name).filter((name) => name !== path);
  if (stale.length > 0) {
    await storage.remove(stale).catch(() => undefined);
  }

  const { error } = await storage.upload(path, file, {
    cacheControl: "3600",
    // The content type must be repeated: the browser does not always preserve
    // it, and Storage would otherwise serve the file as application/octet-stream.
    contentType: file.type,
    upsert: true
  });
  if (error) throw toStorageError(error, "Could not upload that photo. Please try again.");

  const { data } = storage.getPublicUrl(path);
  const url = data.publicUrl;
  if (!url) throw new DataError("DATABASE", "The photo was uploaded but could not be addressed.");
  return url;
};

/** Deletes a user's uploaded avatar, ignoring anything that is not one of ours. */
export const deleteAvatar = async (userId: string, storedUrl: string | null | undefined): Promise<void> => {
  const url = storedUrl?.trim();
  if (!url || !isManagedAvatar(url)) return;

  // Recover the object path from the public URL so the caller does not have to
  // know how the bucket is addressed.
  const marker = `/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return;

  const path = decodeURIComponent(url.slice(at + marker.length));
  // Defensive: never delete outside this user's own folder.
  if (!path.startsWith(`${userId}/`)) return;

  await db().storage.from(BUCKET).remove([path]).catch(() => undefined);
};

/** True when a stored URL points at a file this app manages in the avatars bucket. */
export const isManagedAvatar = (url: string): boolean =>
  /^https:\/\//i.test(url) && url.includes(`/${BUCKET}/`);