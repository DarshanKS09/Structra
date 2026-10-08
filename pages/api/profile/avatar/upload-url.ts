/**
 * Profile avatar upload authorisation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN A DIRECT CLIENT UPLOAD
 * ---------------------------------------------------------------------------
 * The browser would normally upload straight to Storage with its own JWT, and
 * the `storage.objects` RLS policies decide whether that is allowed. Those
 * policies ship in `supabase/migrations/20250101001200_profile_avatars.sql` and
 * must be applied to the project with `supabase db push` or the dashboard SQL
 * editor - they are DDL, so no application code can install them.
 *
 * Until that is done, this route issues a short-lived signed upload URL. The
 * browser then uploads the file directly to Storage, so the bytes never pass
 * through the app and the browser still never sees a service-role key.
 *
 * Once the policies are applied this route can be deleted and the client can go
 * straight back to `storage.upload` with its own credentials; the bucket,
 * object path and validation rules are identical either way.
 *
 * ---------------------------------------------------------------------------
 * THE TRUST BOUNDARY
 * ---------------------------------------------------------------------------
 * The signed token IS the authority: whoever holds it can write to exactly the
 * one object it names. So the path is built here from the VERIFIED session, and
 * the client contributes only a MIME type and a size:
 *
 *   - the caller must present a valid Supabase access token
 *   - `auth.getUser()` is revalidated against the auth server, so a forged or
 *     expired token is rejected
 *   - the folder is `auth.uid()` from that validated response, never from the
 *     request body, so a caller cannot write into another user's folder
 *   - the extension comes from a fixed MIME -> extension table, so neither
 *     `../` traversal nor `.svg` can be smuggled in through a file name
 *
 * Size and MIME limits are enforced here AND by the bucket itself, so the
 * validation still holds against a hand-crafted API call.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { createServerClientForRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMethod, readString, readNumber } from "@/lib/auth/api";
import { MAX_AVATAR_BYTES, ALLOWED_AVATAR_TYPES } from "@/lib/profile/storage";

const BUCKET = "avatars";

/** Fixed MIME -> extension map. The client never supplies an extension. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

/**
 * Resolves the caller's id from their own Supabase session cookie.
 *
 * Validation uses the CALLER's credentials (anon key + their token), not the
 * service role, so the id returned is one Supabase authenticated rather than
 * anything the request asserted.
 *
 * All cookies are handed to `@supabase/ssr` untouched, which is what lets it
 * recombine a chunked session cookie (`<key>.0`, `<key>.1`, ...) itself -
 * reconstructing that by hand is exactly the kind of thing that silently
 * reports a signed-in user as signed out.
 *
 * Writes a 401 and returns null when the caller is not signed in.
 */
const requireUserId = async (req: NextApiRequest, res: NextApiResponse): Promise<string | null> => {
  const userClient = createServerClientForRequest(
    { cookies: req.cookies },
    {
      // Only `setHeader` is needed: reading the session may rotate the refresh
      // token, which must be written back. Next.js' `NextApiResponse.revalidate`
      // has a signature incompatible with the structural adapter, so `res` is
      // not passed directly.
      setHeader: (name, value) => res.setHeader(name, value)
    }
  );

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    res.status(401).json({ ok: false, error: "You must be signed in.", code: "UNAUTHENTICATED" });
    return null;
  }
  return data.user.id;
};

/**
 * POST - returns a short-lived signed upload URL for `<caller id>/avatar.<ext>`,
 * and tidies away any previous upload in a different format.
 */
async function handleMint(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const contentType = readString(req.body, "contentType").toLowerCase().trim();
  const size = readNumber(req.body, "size");

  if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(contentType)) {
    res.status(400).json({
      ok: false,
      error: "Images only: JPEG, PNG, WebP or GIF.",
      code: "VALIDATION"
    });
    return;
  }

  // An unknown size is not fatal - the bucket enforces the real limit - but an
  // oversized one is refused here to save the caller a pointless upload.
  if (size !== null && size > MAX_AVATAR_BYTES) {
    res.status(400).json({
      ok: false,
      error: "That image is too large. Please pick one under 2 MB.",
      code: "VALIDATION"
    });
    return;
  }

  const userId = await requireUserId(req, res);
  if (!userId) return;

  // `contentType` matched the allow-list above, so this always hits; the
  // fallback only satisfies the type checker.
  const extension = EXTENSION_BY_TYPE[contentType] ?? "bin";
  // Path built from the VERIFIED id and the fixed extension table.
  const path = `${userId}/avatar.${extension}`;

  try {
    const bucket = createAdminClient().storage.from(BUCKET);

    // Drop a previous upload in another format, so switching between e.g. PNG
    // and JPEG does not leave an orphan behind. Best-effort: a leftover object
    // is inert and must not block the save the user asked for.
    // Drop a previous upload in another format, so switching between e.g. PNG
    // and JPEG does not leave an orphan behind.
    //
    // Two things are protected from deletion:
    //   - the object about to be written, obviously;
    //   - the object the profile currently points at.
    //
    // The second matters because a ticket can be minted and then abandoned -
    // client-side validation fails, the user cancels, the network drops. If
    // cleanup ran purely on "anything that is not the new path", an abandoned
    // attempt would delete the photo the user actually has, leaving them with
    // none at all. The profile row is the source of truth for what is live, so
    // that path is read back before anything is removed.
    //
    // NOTE the asymmetry, which is easy to get wrong: `list(folder)` returns
    // names RELATIVE to that folder ("avatar.png"), while `remove` needs the
    // FULL object path ("<user id>/avatar.png"). Passing the relative name
    // resolves to nothing and the delete silently no-ops, so the prefix is
    // re-added here.
    const siblings = await bucket
      .list(userId)
      .then((result) => (result.data ?? []).map((entry) => entry.name))
      .catch(() => [] as string[]);

    const live = await createAdminClient()
      .from("profiles")
      .select("avatar_url")
      .eq("id", userId)
      .maybeSingle()
      .then((result) => {
        // The live object name, taken from `profiles.avatar_url` so the cleanup
        // below can never remove what the profile currently points at. Null
        // when the avatar is a built-in, absent, or not one of ours.
        const url = result.data?.avatar_url ?? "";
        const marker = `/${BUCKET}/`;
        const at = url.indexOf(marker);
        if (at < 0) return null;
        // `list` yields names relative to the folder, so compare basenames.
        const name = decodeURIComponent(url.slice(at + marker.length)).split("/").pop() ?? "";
        return name.length > 0 ? name : null;
      })
      .then(null, () => null);

    const keep = new Set([`avatar.${extension}`, live]);
    const stale = siblings
      .filter((name) => !keep.has(name))
      .map((name) => (name.startsWith(`${userId}/`) ? name : `${userId}/${name}`));
    if (stale.length > 0) {
      await bucket.remove(stale).catch(() => undefined);
    }

    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data?.token) {
      res.status(503).json({
        ok: false,
        error: "Could not prepare the upload. Please try again.",
        code: "UNAVAILABLE"
      });
      return;
    }

    res.status(200).json({
      ok: true,
      path,
      token: data.token,
      signedUrl: data.signedUrl
    });
  } catch {
    res.status(503).json({
      ok: false,
      error: "Could not prepare the upload. Please try again.",
      code: "UNAVAILABLE"
    });
  }
}

/**
 * DELETE - removes one of the caller's own uploaded objects, used when the
 * avatar is replaced or reset.
 *
 * The path must sit inside the caller's own folder, so this endpoint can never
 * be used to touch another user's file.
 */
async function handleRemove(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const userId = await requireUserId(req, res);
  if (!userId) return;

  const requested = readString(req.body, "path").trim();
  if (!requested || !requested.startsWith(`${userId}/`)) {
    res.status(400).json({ ok: false, error: "That file cannot be removed.", code: "VALIDATION" });
    return;
  }

  try {
    await createAdminClient().storage.from(BUCKET).remove([requested]);
  } catch {
    // Best-effort: the profile no longer references the object, so a failure
    // here cannot break the user's visible state.
  }
  res.status(200).json({ ok: true });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === "DELETE") {
    if (!requireMethod(req, res, ["DELETE"])) return;
    await handleRemove(req, res);
    return;
  }
  if (!requireMethod(req, res, ["POST"])) return;
  await handleMint(req, res);
}