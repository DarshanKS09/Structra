/**
 * Avatar options and resolution.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES IN `profiles.avatar_url`
 * ---------------------------------------------------------------------------
 * One text column holds all three avatar kinds, and the shape of the value
 * identifies which:
 *
 *   data:image/svg+xml,...   a built-in avatar (small, self-contained)
 *   https://.../avatars/...  a photo the user uploaded (Supabase Storage)
 *   null                     no choice made yet, so show the user's initial
 *
 * Deriving the kind from the stored value keeps the schema unchanged - there is
 * no new column, no new table and no discriminator to keep in sync.
 *
 * ---------------------------------------------------------------------------
 * WHY BUILT-IN AVATARS ARE INLINE SVG DATA URIs
 * ---------------------------------------------------------------------------
 * They are generated locally and stored as `data:` URIs rather than shipped as
 * image files, because:
 *
 *   - no static assets to build, bundle or host
 *   - no network request per option, so the picker renders instantly
 *   - a data URI genuinely is a URL, so the column keeps its meaning
 *   - a selection keeps working if the app is ever self-hosted offline
 */

/** One selectable built-in avatar. */
export type BuiltInAvatar = {
  id: string;
  label: string;
  /** Foreground colours for the gradient. */
  from: string;
  to: string;
  /** Glyph drawn over the gradient. */
  glyph: string;
};

const AVATARS: BuiltInAvatar[] = [
  { id: "aurora", label: "Aurora", from: "#38bdf8", to: "#6366f1", glyph: "A" },
  { id: "ember", label: "Ember", from: "#fb923c", to: "#ef4444", glyph: "E" },
  { id: "forest", label: "Forest", from: "#34d399", to: "#0f766e", glyph: "F" },
  { id: "grape", label: "Grape", from: "#c084fc", to: "#7c3aed", glyph: "G" },
  { id: "rose", label: "Rose", from: "#fb7185", to: "#be123c", glyph: "R" },
  { id: "sand", label: "Sand", from: "#fcd34d", to: "#d97706", glyph: "S" },
  { id: "slate", label: "Slate", from: "#94a3b8", to: "#475569", glyph: "S" },
  { id: "mint", label: "Mint", from: "#5eead4", to: "#0891b2", glyph: "M" }
];

const svgFor = (avatar: BuiltInAvatar): string => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${avatar.from}"/>` +
    `<stop offset="100%" stop-color="${avatar.to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="64" height="64" rx="32" fill="url(#g)"/>` +
    `<text x="32" y="41" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="28" ` +
    `font-weight="700" fill="#ffffff" text-anchor="middle">${avatar.glyph}</text>` +
    `</svg>`;
  // encodeURIComponent keeps the URI safe for use in an <img src>.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

export const BUILT_IN_AVATARS: BuiltInAvatar[] = AVATARS;

/** The data URI actually persisted to `profiles.avatar_url`. */
export const avatarDataUri = (id: string): string | null => {
  const avatar = AVATARS.find((a) => a.id === id);
  return avatar ? svgFor(avatar) : null;
};

export const avatarOptions = (): { id: string; label: string; dataUri: string }[] =>
  AVATARS.map((a) => ({ id: a.id, label: a.label, dataUri: svgFor(a) }));

/**
 * True when the stored value is a built-in avatar rather than an upload.
 *
 * Used by the picker to highlight the active option, and by the "reset" control
 * to tell an uploaded photo apart from a chosen avatar.
 */
export const isBuiltInAvatar = (stored: string | null | undefined): boolean =>
  typeof stored === "string" && stored.startsWith("data:image/svg+xml");

/**
 * Resolves `profiles.avatar_url` to an image source, or `null` when the user
 * has not chosen one.
 *
 * Returning `null` rather than a placeholder image is deliberate: the caller
 * renders the user's initial instead, which has to stay in sync with the name.
 * Substituting a fixed image here would be exactly the behaviour this replaces.
 *
 * Anything unrecognised also resolves to `null`, so a corrupt or unexpected
 * value degrades to an initial rather than a broken image.
 */
export const resolveAvatarSrc = (stored: string | null | undefined): string | null => {
  const trimmed = stored?.trim();
  if (!trimmed) return null;
  if (isBuiltInAvatar(trimmed)) return trimmed;
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  // Plain http is accepted only for loopback, so a misconfigured public URL
  // cannot pull the avatar onto an insecure or attacker-chosen origin.
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(trimmed)) return trimmed;
  return null;
};

/**
 * The uppercase initial shown until the user picks an avatar.
 *
 * Prefers the display name, falls back to the email's local part so a user who
 * has not set a name still gets a stable letter rather than a placeholder. Only
 * the first letter of the first word is used, per the product requirement.
 */
export const initialOf = (displayName: string | null | undefined, email?: string | null): string => {
  const fromName = displayName?.trim();
  const source = fromName || email?.trim().split("@")[0]?.trim() || "";
  // Skip to the first alphanumeric character, so a name like "!!!" or "..."
  // falls back to "?" instead of rendering punctuation as the identity.
  const match = source.match(/[0-9\p{L}\p{N}]/u);
  if (!match) return "?";
  // toUpperCase on the character, not the whole string: some scripts have
  // multi-character casings that would otherwise overflow the badge.
  return match[0].toUpperCase();
};

/** Up to two letters, used where a wider identity chip is rendered. */
export const initialsOf = (displayName: string | null | undefined, email?: string | null): string => {
  const source = displayName?.trim() || email?.trim() || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};