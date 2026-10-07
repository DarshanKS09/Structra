/**
 * Built-in avatar options: animals and the initial fallback.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES IN `profiles.avatar_url`
 * ---------------------------------------------------------------------------
 * One text column holds all three avatar kinds, and the shape of the value
 * identifies which:
 *
 *   data:image/svg+xml,...   a built-in animal avatar (small, self-contained)
 *   https://.../avatars/...  a photo the user uploaded (Supabase Storage)
 *   null                     no choice made yet, so show the user's initial
 *
 * Deriving the kind from the stored value keeps the schema unchanged - there is
 * no new column, no new table and no discriminator to keep in sync.
 *
 * ---------------------------------------------------------------------------
 * WHY ANIMALS ARE INLINE SVG DATA URIS
 * ---------------------------------------------------------------------------
 * Each animal is drawn with plain SVG primitives and stored as a `data:` URI
 * rather than shipped as an image file, because:
 *
 *   - no static assets to build, bundle or host
 *   - no network request per option, so the picker renders instantly
 *   - a data URI genuinely is a URL, so the column keeps its meaning
 *   - a selection keeps working if the app is ever self-hosted offline
 *   - one definition scales to any size the picker or header needs
 *
 * Faces are built from a consistent vocabulary - head, ears, muzzle, eyes -
 * so the twelve options read as one set rather than twelve unrelated doodles.
 * Every animal carries its own gradient, which is what makes the grid scannable
 * at 44 px.
 */

export type BuiltInAvatar = {
  id: string;
  label: string;
  /** Background gradient. */
  from: string;
  to: string;
  /** Face geometry, drawn over the gradient. */
  render: () => string;
};

const ANIMALS: BuiltInAvatar[] = [
  {
    id: "tiger",
    label: "Tiger",
    from: "#fbbf24",
    to: "#ea580c",
    render: () =>
      // Ears sit behind the head so the join is hidden.
      `<circle cx="17" cy="21" r="7" fill="#c2410c"/><circle cx="47" cy="21" r="7" fill="#c2410c"/>` +
      `<ellipse cx="32" cy="35" rx="19" ry="17.5" fill="#fde68a"/>` +
      `<path d="M32 18v7M24 20l2 6M40 20l-2 6" stroke="#c2410c" stroke-width="2.6" stroke-linecap="round"/>` +
      `<path d="M14 30l6 3M14 38l6-1M50 30l-6 3M50 38l-6-1" stroke="#c2410c" stroke-width="2.6" stroke-linecap="round"/>` +
      `<ellipse cx="32" cy="43" rx="11" ry="8" fill="#fffbeb"/>` +
      `<path d="M28 39h8l-4 4.5z" fill="#1c1917"/>` +
      `<path d="M32 43.5v3M32 46.5c-2.5 0-4-1.2-4.5-3M32 46.5c2.5 0 4-1.2 4.5-3" stroke="#1c1917" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
      `<ellipse cx="25" cy="33" rx="2.4" ry="2.8" fill="#1c1917"/><ellipse cx="39" cy="33" rx="2.4" ry="2.8" fill="#1c1917"/>` +
      `<circle cx="25.9" cy="32.1" r="0.9" fill="#fff"/><circle cx="39.9" cy="32.1" r="0.9" fill="#fff"/>` +
      `<path d="M20 41h-7M20 44h-7M44 41h7M44 44h7" stroke="#fffbeb" stroke-width="1.4" stroke-linecap="round"/>`
  },
  {
    id: "lion",
    label: "Lion",
    from: "#fcd34d",
    to: "#b45309",
    render: () => {
      // A ring of overlapping circles gives the mane a soft, scalloped edge.
      let mane = `<circle cx="32" cy="34" r="19" fill="#a16207"/>`;
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2;
        mane += `<circle cx="${(32 + Math.cos(a) * 19).toFixed(1)}" cy="${(34 + Math.sin(a) * 19).toFixed(1)}" r="6.5" fill="#a16207"/>`;
      }
      return (
        mane +
        `<circle cx="21" cy="22" r="5" fill="#d97706"/><circle cx="43" cy="22" r="5" fill="#d97706"/>` +
        `<circle cx="32" cy="35" r="15.5" fill="#fef3c7"/>` +
        `<ellipse cx="32" cy="42" rx="8.5" ry="6.5" fill="#fffbeb"/>` +
        `<path d="M29 38.5h6l-3 3.5z" fill="#78350f"/>` +
        `<path d="M32 42v2.5M32 44.5c-2 0-3.2-1-3.6-2.4M32 44.5c2 0 3.2-1 3.6-2.4" stroke="#78350f" stroke-width="1.4" fill="none" stroke-linecap="round"/>` +
        `<circle cx="26" cy="33" r="2" fill="#78350f"/><circle cx="38" cy="33" r="2" fill="#78350f"/>`
      );
    }
  },
  {
    id: "elephant",
    label: "Elephant",
    from: "#cbd5e1",
    to: "#475569",
    render: () =>
      `<ellipse cx="14" cy="33" rx="9" ry="13" fill="#94a3b8"/><ellipse cx="50" cy="33" rx="9" ry="13" fill="#94a3b8"/>` +
      `<circle cx="32" cy="29" r="17" fill="#e2e8f0"/>` +
      // Trunk: a tapering curve, drawn as a stroke so it reads as a trunk.
      `<path d="M32 42c0 8-.6 12-3.4 15" stroke="#cbd5e1" stroke-width="7.5" fill="none" stroke-linecap="round"/>` +
      `<path d="M28.6 57c2.4 1.2 4.4.6 5.6-1.4" stroke="#94a3b8" stroke-width="3" fill="none" stroke-linecap="round"/>` +
      `<path d="M25 47c-1 3-1.6 5-2.4 6.4M39 47c1 3 1.6 5 2.4 6.4" stroke="#f8fafc" stroke-width="2.6" stroke-linecap="round"/>` +
      `<circle cx="25" cy="29" r="2.1" fill="#334155"/><circle cx="39" cy="29" r="2.1" fill="#334155"/>` +
      `<circle cx="25.8" cy="28.2" r="0.8" fill="#fff"/><circle cx="39.8" cy="28.2" r="0.8" fill="#fff"/>`
  },
  {
    id: "panda",
    label: "Panda",
    from: "#e2e8f0",
    to: "#64748b",
    render: () =>
      `<circle cx="18" cy="18" r="7.5" fill="#0f172a"/><circle cx="46" cy="18" r="7.5" fill="#0f172a"/>` +
      `<circle cx="32" cy="34" r="19" fill="#f8fafc"/>` +
      `<ellipse cx="24.5" cy="30" rx="5.2" ry="6" fill="#0f172a" transform="rotate(-18 24.5 30)"/>` +
      `<ellipse cx="39.5" cy="30" rx="5.2" ry="6" fill="#0f172a" transform="rotate(18 39.5 30)"/>` +
      `<circle cx="24.5" cy="30" r="1.9" fill="#f8fafc"/><circle cx="39.5" cy="30" r="1.9" fill="#f8fafc"/>` +
      `<ellipse cx="32" cy="41" rx="4.2" ry="3.2" fill="#0f172a"/>` +
      `<path d="M32 44v2.6M32 46.6c-2 0-3.2-.9-3.6-2.2M32 46.6c2 0 3.2-.9 3.6-2.2" stroke="#0f172a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
  },
  {
    id: "wolf",
    label: "Wolf",
    from: "#cbd5e1",
    to: "#334155",
    render: () =>
      `<path d="M15 24l1.5-13L26 17z" fill="#475569"/><path d="M49 24l-1.5-13L38 17z" fill="#475569"/>` +
      `<path d="M32 15c11.6 0 19 8 19 18.5S43.6 52 32 52s-19-8-19-18.5S20.4 15 32 15z" fill="#94a3b8"/>` +
      // Lighter mask running down to the muzzle.
      `<path d="M32 26c6 0 10 4.6 10 10s-4.4 8-10 8-10-2.6-10-8 4-10 10-10z" fill="#e2e8f0"/>` +
      `<path d="M29.5 41h5l-2.5 3z" fill="#0f172a"/>` +
      `<path d="M32 44v2.6M32 46.6c-1.8 0-3-.8-3.4-2M32 46.6c1.8 0 3-.8 3.4-2" stroke="#0f172a" stroke-width="1.4" fill="none" stroke-linecap="round"/>` +
      `<ellipse cx="24.5" cy="30" rx="2.5" ry="2" fill="#1e293b"/><ellipse cx="39.5" cy="30" rx="2.5" ry="2" fill="#1e293b"/>` +
      `<circle cx="25.2" cy="29.4" r="0.8" fill="#fde68a"/><circle cx="40.2" cy="29.4" r="0.8" fill="#fde68a"/>`
  },
  {
    id: "fox",
    label: "Fox",
    from: "#fdba74",
    to: "#c2410c",
    render: () =>
      `<path d="M16 23l2-14 11 9z" fill="#c2410c"/><path d="M48 23l-2-14-11 9z" fill="#c2410c"/>` +
      `<path d="M19.5 21.5l1-6 5 4.2z" fill="#7c2d12"/><path d="M44.5 21.5l-1-6-5 4.2z" fill="#7c2d12"/>` +
      `<path d="M32 17c10.4 0 18 8.4 18 19 0 6.6-4.4 11-9.6 13.2L32 55l-8.4-5.8C18.4 47 14 42.6 14 36c0-10.6 7.6-19 18-19z" fill="#fb923c"/>` +
      // White cheeks narrowing to the snout.
      `<path d="M32 38c4.6 0 8 3.2 8 6.6 0 3.6-3.6 6.4-8 6.4s-8-2.8-8-6.4c0-3.4 3.4-6.6 8-6.6z" fill="#fff7ed"/>` +
      `<path d="M29.5 41.5h5L32 45z" fill="#1c1917"/>` +
      `<ellipse cx="25" cy="33" rx="2.2" ry="2.4" fill="#1c1917"/><ellipse cx="39" cy="33" rx="2.2" ry="2.4" fill="#1c1917"/>` +
      `<circle cx="25.8" cy="32.2" r="0.8" fill="#fff"/><circle cx="39.8" cy="32.2" r="0.8" fill="#fff"/>` +
      `<path d="M22 42h-6M22 45h-6M42 42h6M42 45h6" stroke="#fff7ed" stroke-width="1.3" stroke-linecap="round"/>`
  },
  {
    id: "bear",
    label: "Bear",
    from: "#d6a06a",
    to: "#78350f",
    render: () =>
      `<circle cx="18" cy="20" r="7" fill="#5b3410"/><circle cx="46" cy="20" r="7" fill="#5b3410"/>` +
      `<circle cx="32" cy="33" r="18.5" fill="#a16207"/>` +
      `<ellipse cx="32" cy="41" rx="11" ry="9" fill="#fcd9a8"/>` +
      `<ellipse cx="32" cy="37" rx="4" ry="3" fill="#1c1917"/>` +
      `<path d="M32 40v3.4M32 43.4c-2.4 0-4-1.1-4.5-2.8M32 43.4c2.4 0 4-1.1 4.5-2.8" stroke="#1c1917" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
      `<circle cx="25" cy="30" r="2.1" fill="#1c1917"/><circle cx="39" cy="30" r="2.1" fill="#1c1917"/>` +
      `<circle cx="25.7" cy="29.3" r="0.8" fill="#fff"/><circle cx="39.7" cy="29.3" r="0.8" fill="#fff"/>`
  },
  {
    id: "cat",
    label: "Cat",
    from: "#c4b5fd",
    to: "#6d28d9",
    render: () =>
      `<path d="M17 25l1.5-15L30 18z" fill="#7c3aed"/><path d="M47 25l-1.5-15L34 18z" fill="#7c3aed"/>` +
      `<path d="M21 22l.8-8 6 6z" fill="#fbcfe8"/><path d="M43 22l-.8-8-6 6z" fill="#fbcfe8"/>` +
      `<circle cx="32" cy="34" r="18.5" fill="#a78bfa"/>` +
      `<ellipse cx="25.5" cy="33" rx="3" ry="3.4" fill="#1e1b4b"/><ellipse cx="38.5" cy="33" rx="3" ry="3.4" fill="#1e1b4b"/>` +
      `<circle cx="26.4" cy="31.9" r="1" fill="#fff"/><circle cx="39.4" cy="31.9" r="1" fill="#fff"/>` +
      `<path d="M30 40h4l-2 2.4z" fill="#f472b6"/>` +
      `<path d="M32 42.4c-1.6 1.6-4 1.6-5.4.2M32 42.4c1.6 1.6 4 1.6 5.4.2" stroke="#1e1b4b" stroke-width="1.3" fill="none" stroke-linecap="round"/>` +
      `<path d="M19 38h-8M19 41.5h-8M45 38h8M45 41.5h8" stroke="#ede9fe" stroke-width="1.4" stroke-linecap="round"/>`
  },
  {
    id: "owl",
    label: "Owl",
    from: "#99f6e4",
    to: "#0f766e",
    render: () =>
      `<path d="M19 22l-2-13 10 7z" fill="#115e59"/><path d="M45 22l2-13-10 7z" fill="#115e59"/>` +
      `<path d="M32 13c13 0 20 9 20 20.5S45 56 32 56 12 45.5 12 33.5 19 13 32 13z" fill="#14b8a6"/>` +
      `<circle cx="25" cy="32" r="8" fill="#f0fdfa"/><circle cx="39" cy="32" r="8" fill="#f0fdfa"/>` +
      `<circle cx="25" cy="32" r="3.6" fill="#134e4a"/><circle cx="39" cy="32" r="3.6" fill="#134e4a"/>` +
      `<circle cx="26.3" cy="30.7" r="1.3" fill="#fff"/><circle cx="40.3" cy="30.7" r="1.3" fill="#fff"/>` +
      `<path d="M32 38l4 6h-8z" fill="#fbbf24"/>` +
      `<path d="M18 48c4 3 8 4.5 14 4.5s10-1.5 14-4.5" stroke="#0d9488" stroke-width="2" fill="none" stroke-linecap="round"/>`
  },
  {
    id: "penguin",
    label: "Penguin",
    from: "#bae6fd",
    to: "#1e3a8a",
    render: () =>
      `<circle cx="32" cy="32" r="20" fill="#0f172a"/>` +
      `<ellipse cx="32" cy="41" rx="13" ry="15" fill="#f8fafc"/>` +
      `<ellipse cx="25.5" cy="27" rx="2.5" ry="2.8" fill="#0f172a"/><ellipse cx="38.5" cy="27" rx="2.5" ry="2.8" fill="#0f172a"/>` +
      `<circle cx="26.4" cy="25.9" r="1" fill="#fff"/><circle cx="39.4" cy="25.9" r="1" fill="#fff"/>` +
      `<path d="M32 30l6 4.4-6 3.2-6-3.2z" fill="#fb923c"/>` +
      `<path d="M14 40c1.6 6 4 10 7 13M50 40c-1.6 6-4 10-7 13" stroke="#1e293b" stroke-width="3" fill="none" stroke-linecap="round"/>`
  },
  {
    id: "koala",
    label: "Koala",
    from: "#d6d3d1",
    to: "#57534e",
    render: () =>
      // Koala ears are oversized relative to the head - that is the read.
      `<circle cx="12" cy="30" r="11" fill="#78716c"/><circle cx="52" cy="30" r="11" fill="#78716c"/>` +
      `<circle cx="12" cy="30" r="6" fill="#a8a29e"/><circle cx="52" cy="30" r="6" fill="#a8a29e"/>` +
      `<circle cx="32" cy="36" r="17" fill="#a8a29e"/>` +
      `<ellipse cx="32" cy="45" rx="8" ry="6.5" fill="#292524"/>` +
      `<circle cx="24.5" cy="33" r="2.2" fill="#1c1917"/><circle cx="39.5" cy="33" r="2.2" fill="#1c1917"/>` +
      `<circle cx="25.2" cy="32.2" r="0.9" fill="#fff"/><circle cx="40.2" cy="32.2" r="0.9" fill="#fff"/>` +
      `<circle cx="32" cy="42.6" r="1.6" fill="#57534e"/><circle cx="28.4" cy="44.6" r="1.6" fill="#57534e"/><circle cx="35.6" cy="44.6" r="1.6" fill="#57534e"/>`
  },
  {
    id: "monkey",
    label: "Monkey",
    from: "#fdba74",
    to: "#92400e",
    render: () =>
      `<circle cx="12" cy="33" r="8" fill="#b45309"/><circle cx="52" cy="33" r="8" fill="#b45309"/>` +
      `<circle cx="12" cy="33" r="4.5" fill="#fcd9a8"/><circle cx="52" cy="33" r="4.5" fill="#fcd9a8"/>` +
      `<circle cx="32" cy="34" r="18.5" fill="#d97706"/>` +
      `<ellipse cx="32" cy="37" rx="13" ry="14" fill="#fcd9a8"/>` +
      `<circle cx="25.5" cy="32" r="2.2" fill="#1c1917"/><circle cx="38.5" cy="32" r="2.2" fill="#1c1917"/>` +
      `<circle cx="26.3" cy="31.2" r="0.9" fill="#fff"/><circle cx="39.3" cy="31.2" r="0.9" fill="#fff"/>` +
      `<ellipse cx="29.4" cy="38" rx="1" ry="1.4" fill="#92400e"/><ellipse cx="34.6" cy="38" rx="1" ry="1.4" fill="#92400e"/>` +
      `<path d="M24 42c2.4 3.4 5.2 5 8 5s5.6-1.6 8-5" stroke="#1c1917" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
  }
];

const svgFor = (avatar: BuiltInAvatar): string => {
  // The gradient id is namespaced per avatar. Every avatar is normally loaded
  // as its own <img src>, so ids could not collide - but SVG ids are
  // document-scoped, and if these were ever inlined into one document (a
  // printed sheet, a server-rendered email header, an embed) a shared id="g"
  // would make all twelve render with whichever gradient the DOM parsed first.
  const gradientId = `g-${avatar.id}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${avatar.from}"/>` +
    `<stop offset="100%" stop-color="${avatar.to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="64" height="64" rx="32" fill="url(#${gradientId})"/>` +
    avatar.render() +
    `</svg>`;
  // encodeURIComponent keeps the URI safe for use in an <img src>.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

export const BUILT_IN_AVATARS: BuiltInAvatar[] = ANIMALS;

/** The data URI actually persisted to `profiles.avatar_url`. */
export const avatarDataUri = (id: string): string | null => {
  const avatar = ANIMALS.find((a) => a.id === id);
  return avatar ? svgFor(avatar) : null;
};

export const avatarOptions = (): { id: string; label: string; dataUri: string }[] =>
  ANIMALS.map((a) => ({ id: a.id, label: a.label, dataUri: svgFor(a) }));

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