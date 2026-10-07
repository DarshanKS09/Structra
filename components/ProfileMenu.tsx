"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/lib/auth/AuthProvider";
import { updateProfile } from "@/lib/data/account";
import { toDataError, type DataError } from "@/lib/data/errors";
import { avatarOptions, avatarDataUri, initialsOf, resolveAvatar } from "@/lib/profile/avatars";

/**
 * Renders an avatar.
 *
 * A plain `<img>` rather than `next/image`, deliberately. Every avatar here is
 * an inline `data:image/svg+xml` URI: there is no file to optimise, nothing to
 * fetch, and `next/image` would add an optimiser round trip and a domain check
 * for zero benefit. The rule is disabled in exactly one place rather than
 * repeated at every call site.
 */
function Avatar({ src, alt, className }: { src: string; alt: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

/**
 * Profile control.
 *
 * Sits in the existing header beside the theme button, so the layout is
 * unchanged. A popover rather than a page keeps it compact: viewing the
 * profile, renaming, choosing an avatar and signing out are all reachable
 * without a navigation.
 *
 * Writes go to the existing `profiles` table through `updateProfile`. No new
 * table was created, and no user id is supplied by this component - the row is
 * addressed by the authenticated session, and RLS restricts it to the owner.
 */
export function ProfileMenu() {
  const { user, profile, refresh, signOut } = useAuth();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(
    profile?.avatar_url ?? null
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<DataError | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const options = avatarOptions();

  // Re-sync from the server whenever the loaded profile changes (e.g. after a
  // refresh), so the inputs never show stale local edits.
  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
    setSelectedAvatar(profile?.avatar_url ?? null);
  }, [profile?.display_name, profile?.avatar_url]);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const currentAvatar = resolveAvatar(selectedAvatar ?? profile?.avatar_url);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Addressed by the session's user id, never by anything the UI collected.
      await updateProfile(user.id, {
        display_name: displayName.trim() || null,
        avatar_url: selectedAvatar ?? null
      });
      await refresh();
      setSaved(true);
    } catch (caught) {
      setError(toDataError(caught));
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = async (id: string) => {
    const uri = avatarDataUri(id);
    if (!uri) return;
    setSelectedAvatar(uri);
    setError(null);
    setSaved(false);
    // Persist immediately so the choice survives a refresh without extra clicks.
    if (!user) return;
    try {
      await updateProfile(user.id, { avatar_url: uri });
      await refresh();
      setSaved(true);
    } catch (caught) {
      setError(toDataError(caught));
    }
  };

  const handleSignOut = async () => {
    await signOut();
    void router.replace("/login");
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Profile"
        title={profile?.display_name ?? user?.email ?? "Profile"}
        className="h-10 w-10 overflow-hidden rounded-full border border-white/25 bg-white/10 transition hover:border-white/50"
      >
        <Avatar src={currentAvatar} alt="" className="h-full w-full object-cover" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Profile"
          className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-white/15 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl light:border-slate-300 light:bg-white"
        >
          <div className="flex items-center gap-3">
            <Avatar
              src={currentAvatar}
              alt=""
              className="h-12 w-12 shrink-0 rounded-full border border-white/20 object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {profile?.display_name?.trim() || "No name set"}
              </p>
              <p className="truncate text-[11px] text-slate-400 light:text-slate-500">
                {user?.email ?? ""}
              </p>
            </div>
          </div>

          <label className="mt-4 block">
            <span className="mb-1 block text-[11px] text-slate-300 light:text-slate-600">
              Display name
            </span>
            <input
              type="text"
              maxLength={120}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setSaved(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="Your name"
              className="themed-accent-ring w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-slate-400 light:border-slate-300 light:bg-white light:text-slate-800"
            />
          </label>

          <p className="mt-3 mb-1.5 text-[11px] text-slate-300 light:text-slate-600">
            Avatar
          </p>
          <div className="grid grid-cols-4 gap-2">
            {options.map((option) => {
              const isActive = currentAvatar === option.dataUri;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void pickAvatar(option.id)}
                  title={option.label}
                  aria-label={`${option.label} avatar`}
                  aria-pressed={isActive}
                  className={`h-11 w-11 overflow-hidden rounded-full border-2 transition ${
                    isActive
                      ? "themed-accent-solid border-transparent"
                      : "border-white/25 hover:border-white/60"
                  }`}
                >
                  <Avatar src={option.dataUri} alt="" className="h-full w-full object-cover" />
                </button>
              );
            })}
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-[11px] text-rose-300 light:text-rose-700">
              {error.message}
            </p>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="themed-accent-solid h-10 flex-1 rounded-xl text-xs font-semibold disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save name"}
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="h-10 rounded-xl border border-rose-400/40 px-3 text-xs font-medium text-rose-200 light:text-rose-700"
            >
              Sign out
            </button>
          </div>

          {saved ? (
            <p className="mt-2 text-center text-[11px] text-emerald-300 light:text-emerald-700">
              Saved
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Small initials badge, used before an avatar has been chosen.
 * Exported so the header can render a consistent identity chip.
 */
export function ProfileInitials({
  displayName,
  email,
  className = ""
}: {
  displayName?: string | null;
  email?: string | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-xs font-semibold text-slate-950 ${className}`}
      aria-hidden
    >
      {initialsOf(displayName, email)}
    </span>
  );
}