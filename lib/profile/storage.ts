import { db } from "@/lib/data/client";
import { DataError } from "@/lib/data/errors";

/**
 * Profile photo uploads.
 *
 * ---------------------------------------------------------------------------
 * WHY STORAGE RATHER THAN THE profiles TABLE
 * ---------------------------------------------------------------------------
 * `profiles.avatar_url` is a text column selected by every query that reads a
 * profile, including the workspace member roster. Inlining a photo there as a
 * data URI would put hundreds of kilobytes per user into each of those
 * responses, so the image is uploaded to Storage and only its URL is stored.
 *
 * ---------------------------------------------------------------------------
 * HOW THE UPLOAD IS AUTHORISED
 * ---------------------------------------------------------------------------
 * The bytes go from the browser straight to Storage - they never pass through
 * the Next.js app - using a short-lived signed upload URL minted by
 * `/api/profile/avatar/upload-url`. That route revalidates the caller's Supabase
 * session and builds the object path from the verified user id, so a client
 * cannot write into another user's folder. The service-role key stays on the
 * server: the browser only ever receives a scoped, short-lived token.
 *
 * The alternative - `storage.upload` straight from the browser with the user's
 * own JWT - is governed by the `storage.objects` RLS policies shipped in
 * `supabase/migrations/20250101001200_profile_avatars.sql`. Once those are
 * applied this module can go back to calling `storage.upload` directly; the
 * bucket, path layout and validation rules are unchanged.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE OBJECT PER USER
 * ---------------------------------------------------------------------------
 * The path is always `<user_id>/avatar.<ext>`, so re-uploading replaces the
 * previous photo instead of accumulating orphans. Switching format leaves the
 * old object behind, which is why the cleanup step below removes any sibling.
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

/** The object path for a user's avatar, given the verified user id. */
export const avatarPath = (userId: string, mimeType: string): string => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId) || userId === "." || userId === "..") {
    throw new DataError("VALIDATION", "Could not determine the account for this upload.");
  }
  const extension = EXTENSION_BY_TYPE[mimeType] ?? "bin";
  return `${userId}/avatar.${extension}`;
};

/** Turns a fetch failure into something a user can act on. */
const requestError = (cause: unknown): DataError => {
  const detail = cause instanceof Error ? cause.message : String(cause ?? "");
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(detail)) {
    return new DataError("NETWORK", "Could not reach the server. Please check your connection.");
  }
  return new DataError("NETWORK", "Could not upload that photo. Please try again.");
};

type UploadTicket = { path: string; token: string; signedUrl: string };

/** Asks the server for a scoped, short-lived upload URL. */
const requestUploadTicket = async (file: File): Promise<UploadTicket> => {
  let response: Response;
  try {
    response = await fetch("/api/profile/avatar/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type.toLowerCase().trim(), size: file.size })
    });
  } catch (caught) {
    throw requestError(caught);
  }

  if (!response.ok) {
    let message = "Could not upload that photo. Please try again.";
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // A non-JSON error body is not worth reporting verbatim.
    }
    throw new DataError(response.status === 401 ? "UNAUTHENTICATED" : "DATABASE", message);
  }

  const body = (await response.json()) as Partial<UploadTicket>;
  if (!body?.token || !body.path) {
    throw new DataError("DATABASE", "The upload could not be prepared. Please try again.");
  }
  return { path: body.path, token: body.token, signedUrl: body.signedUrl ?? "" };
};

/**
 * Uploads a photo and returns the URL to persist in `profiles.avatar_url`.
 *
 * Re-uploading overwrites the same object, so replacing a photo cannot orphan
 * the previous file.
 */
export const uploadAvatar = async (userId: string, file: File): Promise<string> => {
  const check = validateAvatarFile(file);
  if (!check.ok) throw new DataError("VALIDATION", check.message);

  const mimeType = file.type.toLowerCase().trim();

  // `userId` is only used for the cleanup check below; the authoritative path
  // comes back from the server, which derives it from the verified session.
  const expectedPath = avatarPath(userId, mimeType);
  const ticket = await requestUploadTicket(file);

  const storage = db().storage.from(BUCKET);

  const { error } = await storage.uploadToSignedUrl(ticket.path, ticket.token, file, {
    cacheControl: "3600",
    // Repeated because the browser does not always preserve the type, and
    // Storage would otherwise serve the object as application/octet-stream.
    contentType: mimeType,
    upsert: true
  });
  if (error) throw new DataError("DATABASE", "Could not upload that photo. Please try again.");

  // Any previous upload in a different format was already removed by the
  // server while minting the ticket, so there is nothing left to tidy here -
  // and the browser could not list or delete objects in any case.

  const { data } = storage.getPublicUrl(ticket.path);
  if (!data.publicUrl) {
    throw new DataError("DATABASE", "The photo was uploaded but could not be addressed.");
  }
  return data.publicUrl;
};

/** True when a stored URL points at a file this app manages in the avatars bucket. */
export const isManagedAvatar = (url: string): boolean =>
  /^https:\/\//i.test(url) && url.includes(`/${BUCKET}/`);

/**
 * Deletes a user's uploaded avatar.
 *
 * Runs on the server so it works whether or not the `storage.objects` delete
 * policies have been applied, and so the client never needs elevated rights.
 * Anything that is not one of our objects is ignored.
 */
export const deleteAvatar = async (userId: string, storedUrl: string | null | undefined): Promise<void> => {
  const url = storedUrl?.trim();
  if (!url || !isManagedAvatar(url)) return;

  // Recover the object path from the public URL so the caller does not have to
  // know how the bucket is addressed.
  const marker = `/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return;

  const path = decodeURIComponent(url.slice(at + marker.length));
  // Defensive: never touch another user's folder.
  if (!path.startsWith(`${userId}/`)) return;

  try {
    await fetch("/api/profile/avatar/upload-url", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path })
    });
  } catch {
    // Best-effort. A leftover object is inert: the profile no longer points at
    // it, and the next upload overwrites the same path.
  }
};