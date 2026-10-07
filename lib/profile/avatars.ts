/**
 * Built-in avatar options.
 *
 * ---------------------------------------------------------------------------
 * WHY INLINE SVG DATA URIs
 * ---------------------------------------------------------------------------
 * The avatars are generated locally and stored as `data:` URIs in
 * `profiles.avatar_url`. That was chosen over shipping image files because:
 *
 *   - no new static assets to build, bundle or host
 *   - no network request per avatar in the picker, so it renders instantly
 *   - a data URI genuinely is a URL, so the column keeps its meaning
 *   - a selected avatar keeps working if the app is ever self-hosted offline
 *
 * Each avatar is a deterministic gradient plus a geometric mark, seeded from a
 * fixed id, so a given option always looks the same.
 */

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

/** The avatar shown before one has been chosen. */
export const DEFAULT_AVATAR_URI = svgFor(AVATARS[0]);

/**
 * Resolves whatever is stored in `profiles.avatar_url` to something renderable.
 *
 * Two shapes are supported: one of our own data URIs, and any absolute URL a
 * user may have had stored previously. Anything unrecognised falls back to the
 * default rather than rendering a broken image.
 */
export const resolveAvatar = (stored: string | null | undefined): string => {
  if (!stored) return DEFAULT_AVATAR_URI;
  const trimmed = stored.trim();
  if (!trimmed) return DEFAULT_AVATAR_URI;
  if (trimmed.startsWith("data:image/svg+xml") || /^https?:\/\//i.test(trimmed)) return trimmed;
  return DEFAULT_AVATAR_URI;
};

/** Up to two letters for the initials badge. */
export const initialsOf = (displayName: string | null | undefined, email?: string | null): string => {
  const source = displayName?.trim() || email?.trim() || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};