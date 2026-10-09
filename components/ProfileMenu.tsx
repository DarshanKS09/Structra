"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { updateProfile } from "@/lib/data/account";
import { toDataError, DataError } from "@/lib/data/errors";
import {
  avatarOptions,
  avatarDataUri,
  initialOf,
  initialsOf,
  resolveAvatarSrc
} from "@/lib/profile/avatars";
import {
  uploadAvatar,
  deleteAvatar,
  isManagedAvatar,
  validateAvatarFile
} from "@/lib/profile/storage";
import { useThemeController } from "@/lib/hooks/useThemeController";
import {
  ALARM_SOUNDS,
  audioBlockedReason,
  mergeAlarmSettings,
  playAlarm,
  readAlarmSettings,
  unlockAudio,
  type AlarmSettings,
  type AlarmSound
} from "@/lib/reminders/alarm";
import { saveUserSettings } from "@/lib/data/account";
import type { Appearance, DarkAccent } from "@/store/useTaskStore";

/**
 * Exactly two appearance choices.
 *
 * "System" was removed on purpose: with it present, "Light" and "Dark" could each
 * be silently overridden by the operating system, so the label would not describe
 * what the user was actually looking at.
 */
const APPEARANCE_OPTIONS: { value: Appearance; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Use the light theme" },
  { value: "dark", label: "Dark", hint: "Use a dark theme" }
];

/** The two existing dark accents. Light has no accent choice. */
const ACCENT_OPTIONS: { value: DarkAccent; label: string }[] = [
  { value: "ocean", label: "Ocean" },
  { value: "crimson", label: "Crimson" }
];

/**
 * Renders an avatar image.
 *
 * A plain `<img>` rather than `next/image`, deliberately. Built-in avatars are
 * inline `data:image/svg+xml` URIs, and an upload lives in Supabase Storage -
 * neither is an importable static asset, so `next/image` would add an optimiser
 * round trip and a remote-domain allowlist entry for no benefit at 40-48 px.
 * The rule is disabled in exactly one place rather than at every call site.
 */
function Avatar({ src, alt, className }: { src: string; alt: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

/**
 * The initial badge shown until an avatar is chosen.
 *
 * Kept as its own component so the header trigger, the popover preview and the
 * roster chip cannot drift apart in size or colour.
 */
function InitialBadge({
  label,
  className = "",
  textClassName = "text-xs"
}: {
  label: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center bg-sky-500 font-semibold text-slate-950 ${textClassName} ${className}`}
      aria-hidden
    >
      {label}
    </span>
  );
}

/**
 * Profile control.
 *
 * Sits in the existing header beside the theme button, so the layout is
 * unchanged. A popover rather than a page keeps it compact: viewing the
 * profile, renaming, choosing an avatar and signing out are all reachable
 * without a navigation.
 *
 * Writes go to the existing `profiles` table through `updateProfile`, addressed
 * by the authenticated session rather than by anything this component collected;
 * RLS restricts the row to its owner. Uploaded photos go to Supabase Storage and
 * only the resulting URL is written to the column.
 */
export function ProfileMenu() {
  const { user, profile, settings, refresh, signOut } = useAuth();
  // Appearance is read here and nowhere else in the UI, which is what keeps a
  // theme control from reappearing in a header.
  const { appearance, darkAccent, setAppearance, setDarkAccent } = useThemeController();

  /*
   * Alarm settings live in the existing `user_settings.preferences` jsonb column,
   * so this needs no migration and no new table - it rides alongside the theme
   * setting that is already stored there.
   */
  const [alarmSettings, setAlarm] = useState<AlarmSettings>(() =>
    readAlarmSettings(settings?.preferences)
  );

  // Re-read when the server row changes (e.g. after refresh), so the control never
  // shows a stale local edit.
  useEffect(() => {
    setAlarm(readAlarmSettings(settings?.preferences));
  }, [settings?.preferences]);

  const setAlarmSettings = useCallback(
    async (patch: Partial<AlarmSettings>): Promise<void> => {
      if (!user) return;
      const previous = alarmSettings;
      const next = { ...alarmSettings, ...patch };
      // Optimistic: the switch should feel instant.
      setAlarm(next);
      try {
        await saveUserSettings(user.id, {
          preferences: mergeAlarmSettings(settings?.preferences, next) as never
        });
        await refresh();
      } catch (caught) {
        // Restore, so the control never claims a preference the server rejected.
        setAlarm(previous);
        setError(toDataError(caught, "Could not save that reminder setting."));
      }
    },
    [alarmSettings, settings?.preferences, user, refresh]
  );

  /**
   * "Test alarm" doubles as the audio unlock gesture.
   *
   * Browsers only allow sound after a real user interaction, and this click IS
   * one - so pressing it is what grants permission, which is why the copy tells
   * the user to try it once. A short preview is played rather than the full
   * duration, and it stops itself.
   */
  const previewAlarm = useCallback(async (): Promise<void> => {
    const unlocked = await unlockAudio();
    if (!unlocked) {
      setError(
        new DataError(
          "VALIDATION",
          "This browser is blocking sound. Interact with the page and try again."
        )
      );
      return;
    }
    setError(null);
    playAlarm(alarmSettings.sound, 2);
  }, [alarmSettings.sound]);

  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(profile?.avatar_url ?? null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<DataError | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const options = avatarOptions();

  /**
   * A file the user has picked but not yet saved.
   *
   * Held in component state only: an unconfirmed pick must never reach
   * `profiles` or Storage, and nothing here is persisted anywhere.
   */
  const [pendingPhoto, setPendingPhoto] = useState<{ file: File; preview: string } | null>(null);

  // Object URLs are not garbage collected on their own. Revoking the previous
  // one when a new file is picked, and on unmount, keeps them from leaking for
  // the lifetime of the document.
  const pendingPreviewRef = useRef<string | null>(null);
  useEffect(() => {
    pendingPreviewRef.current = pendingPhoto?.preview ?? null;
  }, [pendingPhoto]);
  useEffect(
    () => () => {
      if (pendingPreviewRef.current) URL.revokeObjectURL(pendingPreviewRef.current);
    },
    []
  );

  const discardPendingPhoto = useCallback(() => {
    setPendingPhoto((previous) => {
      if (previous?.preview) URL.revokeObjectURL(previous.preview);
      return null;
    });
    setError(null);
    setSaved(false);
  }, []);

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

  const name = profile?.display_name?.trim() || "";
  const fallbackEmail = user?.email ?? null;

  // Priority: uploaded photo > built-in avatar > initial. `resolveAvatarSrc`
  // returning null is what selects the initial.
  const avatarSrc = resolveAvatarSrc(selectedAvatar ?? profile?.avatar_url);
  const initial = initialOf(name, fallbackEmail);
  const hasUpload = isManagedAvatar(selectedAvatar ?? profile?.avatar_url ?? "");

  /**
   * Persists an avatar value, tolerating failure.
   *
   * The previous value is kept so a rejected write leaves the UI showing what
   * the database still holds, rather than a selection that was never saved.
   */
  const persistAvatar = useCallback(
    async (next: string | null): Promise<boolean> => {
      if (!user) return false;
      const previous = selectedAvatar;
      setSelectedAvatar(next);
      setError(null);
      setSaved(false);
      try {
        await updateProfile(user.id, { avatar_url: next });
        await refresh();
        setSaved(true);
        return true;
      } catch (caught) {
        setSelectedAvatar(previous);
        setError(toDataError(caught));
        return false;
      }
    },
    [user, selectedAvatar, refresh]
  );

  const pickAvatar = async (id: string) => {
    const uri = avatarDataUri(id);
    if (!uri) return;
    // Choosing an animal discards any unsaved pick, so the preview cannot later
    // resurface over the animal the user just chose.
    discardPendingPhoto();
    // Choosing a built-in avatar replaces any upload, so the old file is no
    // longer referenced by the profile.
    const current = selectedAvatar ?? profile?.avatar_url ?? null;
    if (current && isManagedAvatar(current) && user) {
      await deleteAvatar(user.id, current);
    }
    await persistAvatar(uri);
  };

  const resetAvatar = async () => {
    discardPendingPhoto();
    const current = selectedAvatar ?? profile?.avatar_url ?? null;
    if (current && isManagedAvatar(current) && user) {
      await deleteAvatar(user.id, current);
    }
    // null means "no avatar chosen", which makes the initial render again.
    await persistAvatar(null);
  };

  /**
   * Handles a file being picked: validate it, then hold it for preview.
   *
   * Nothing is uploaded yet. On mobile this is what lets the user confirm the
   * right photo was chosen from the gallery before it becomes their avatar.
   */
  const onPickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear the input so picking the same file twice still fires a change event.
    event.target.value = "";
    if (!file) return;

    // Release the previous preview before taking a new one.
    if (pendingPhoto?.preview) URL.revokeObjectURL(pendingPhoto.preview);

    const check = validateAvatarFile(file);
    if (!check.ok) {
      setPendingPhoto(null);
      setError(toDataError(new DataError("VALIDATION", check.message)));
      setSaved(false);
      return;
    }

    setError(null);
    setSaved(false);
    setPendingPhoto({ file, preview: URL.createObjectURL(file) });
  };

  /** Uploads the previewed file and makes it the profile avatar. */
  const confirmUpload = async () => {
    if (!pendingPhoto || !user) return;
    const { file, preview } = pendingPhoto;

    setUploading(true);
    setError(null);
    setSaved(false);
    try {
      // Order matters, and it is the whole safety story of a replacement:
      //
      //   1. upload the new object      - nothing is lost if this fails
      //   2. point the profile at it    - the DB now references the new file
      //   3. delete the previous object - only now is it unreferenced
      //
      // Deleting the old image before step 2 (as this used to) meant a failed
      // profile update left `avatar_url` pointing at a deleted object, i.e. a
      // broken avatar with no way back. Doing it in this order means any failure
      // leaves the user with a working photo.
      const url = await uploadAvatar(user.id, file);

      setSelectedAvatar(url);
      setPendingPhoto(null);
      if (preview) URL.revokeObjectURL(preview);
      await updateProfile(user.id, { avatar_url: url });

      // The new avatar is live and persisted, so the old one is now safe to drop.
      // Best-effort: a leftover object is inert, and failing here must not be
      // reported as a failed upload.
      const previous = selectedAvatar ?? profile?.avatar_url ?? null;
      if (previous && isManagedAvatar(previous)) {
        void deleteAvatar(user.id, previous).catch(() => undefined);
      }

      await refresh();
      setSaved(true);
    } catch (caught) {
      // The profile is unchanged and the preview is kept, so the user can retry
      // without picking the file again.
      setError(toDataError(caught));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Addressed by the session's user id, never by anything the UI collected.
      await updateProfile(user.id, {
        display_name: displayName.trim() || null
      });
      await refresh();
      setSaved(true);
    } catch (caught) {
      setError(toDataError(caught));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Signs out and lands on the login page with a FULL navigation.
   *
   * `router.replace` would only change the client-side route, so
   * `getServerSideProps` would never re-run and the app's React tree would
   * survive the sign-out. A hard navigation is what guarantees the protected
   * page re-evaluates the now-absent session from scratch, so reopening
   * Structra cannot restore the previous session from memory.
   */
  const handleSignOut = async () => {
    setSaving(true);
    setError(null);
    const failure = await signOut();
    if (failure) {
      setError(failure);
      setSaving(false);
      return;
    }
    // `replace` so the app does not sit in history; a refresh afterwards must
    // land on /login, not bounce back into the app.
    window.location.replace("/login");
  };

  const preview = avatarSrc ? (
    <Avatar src={avatarSrc} alt="" className="h-full w-full object-cover" />
  ) : (
    <InitialBadge label={initial} className="h-full w-full" textClassName="text-base" />
  );

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Profile"
        title={name || fallbackEmail || "Profile"}
        className="h-10 w-10 overflow-hidden rounded-full border border-white/25 bg-white/10 transition hover:border-white/50"
      >
        {preview}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Profile"
          className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-white/15 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl light:border-slate-300 light:bg-white"
        >
          <div className="flex items-center gap-3">
            <span className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/20">
              {avatarSrc ? (
                <Avatar src={avatarSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                <InitialBadge label={initial} className="h-full w-full" textClassName="text-lg" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{name || "No name set"}</p>
              <p className="truncate text-[11px] text-slate-400 light:text-slate-500">
                {fallbackEmail ?? ""}
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
            Your photo
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => void onPickFile(e)}
            className="hidden"
          />

          {pendingPhoto ? (
            // A picked file is previewed before anything is written, so the
            // user can confirm the right image was chosen from their gallery.
            <div className="rounded-xl border border-white/20 bg-white/5 p-2">
              <div className="flex items-center gap-2">
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-full">
                  <Avatar src={pendingPhoto.preview} alt="" className="h-full w-full object-cover" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-slate-200 light:text-slate-800">
                    {pendingPhoto.file.name}
                  </p>
                  <p className="text-[10px] text-slate-400 light:text-slate-500">
                    {(pendingPhoto.file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void confirmUpload()}
                  disabled={uploading}
                  className="themed-accent-solid h-9 flex-1 rounded-lg text-xs font-semibold disabled:opacity-60"
                >
                  {uploading ? "Saving..." : "Save photo"}
                </button>
                <button
                  type="button"
                  onClick={discardPendingPhoto}
                  disabled={uploading}
                  className="h-9 rounded-lg border border-white/25 px-3 text-xs font-medium disabled:opacity-40 light:border-slate-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="h-10 w-full rounded-xl border border-white/25 text-xs font-medium transition hover:border-white/50 disabled:opacity-60 light:border-slate-300"
            >
              {uploading ? "Uploading..." : hasUpload ? "Replace photo" : "Upload from device"}
            </button>
          )}
          <p className="mt-1 text-[10px] text-slate-400 light:text-slate-500">
            JPEG, PNG, WebP or GIF, up to 2 MB. Picked from your device or your phone&apos;s gallery.
          </p>

          <p className="mt-3 mb-1.5 text-[11px] text-slate-300 light:text-slate-600">
            Animal avatars
          </p>
          <div className="grid grid-cols-6 gap-1.5">
            {options.map((option) => {
              const isActive = !hasUpload && avatarSrc === option.dataUri;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void pickAvatar(option.id)}
                  title={option.label}
                  aria-label={`${option.label} avatar`}
                  aria-pressed={isActive}
                  className={`h-10 w-10 overflow-hidden rounded-full border-2 transition ${
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

          {/*
            Appearance lives INSIDE the profile, not as a control in the app
            header. The header previously carried its own round theme swatch next
            to the avatar, which on mobile read as a second avatar - and it meant
            two places to reach for the same setting. There is now exactly one
            entry point, here.
          */}
          <fieldset className="mt-3">
            <legend className="mb-1.5 text-[11px] text-slate-300 light:text-slate-600">
              Theme
            </legend>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Theme">
              {APPEARANCE_OPTIONS.map((option) => {
                const isActive = appearance === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAppearance(option.value)}
                    aria-pressed={isActive}
                    title={option.hint}
                    className={`h-9 rounded-lg border px-2 text-xs font-medium transition ${
                      isActive
                        ? "themed-accent-solid border-transparent"
                        : "border-white/25 hover:border-white/50 light:border-slate-300"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {/*
              Colour is an independent axis, so this row is always shown - in the
              light appearance too. Hiding it here would mean the colour control
              did nothing while in Light, which is the bug this row's visibility
              used to hide rather than fix.
            */}
            <p className="mt-2.5 mb-1 text-[10px] text-slate-400 light:text-slate-500">
              Colour
            </p>
            <div className="flex items-center gap-1.5" role="group" aria-label="Colour">
              {ACCENT_OPTIONS.map((option) => {
                const isActive = darkAccent === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDarkAccent(option.value)}
                    aria-pressed={isActive}
                    className={`h-7 rounded-lg border px-2.5 text-[11px] font-medium transition ${
                      isActive
                        ? "themed-accent-solid border-transparent"
                        : "border-white/25 hover:border-white/50 light:border-slate-300"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/*
            REMINDERS

            Alarm sound lives in Profile rather than in a header, alongside the
            theme control, because it is the same kind of preference: a setting
            about how Structra behaves while you use it.

            The audio caveat is stated in the UI itself rather than only in the
            docs. Browsers refuse to play sound until the page has been interacted
            with, and "Test alarm" doubles as the unlock gesture - so the first
            press is what grants permission, and the copy says so.
          */}
          <fieldset className="mt-3">
            <legend className="mb-1.5 text-[11px] text-slate-300 light:text-slate-600">
              Reminder alarm
            </legend>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/20 px-3 py-2 light:border-slate-300">
              <span className="text-xs">Play a sound when due</span>
              <button
                type="button"
                role="switch"
                aria-checked={alarmSettings.enabled}
                aria-label="Play a sound when a reminder is due"
                onClick={() => void setAlarmSettings({ enabled: !alarmSettings.enabled })}
                className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
                  alarmSettings.enabled ? "themed-accent-solid" : "bg-white/20 light:bg-slate-300"
                }`}
              >
                <span
                  className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                    alarmSettings.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {alarmSettings.enabled ? (
              <>
                <div className="mt-2 flex items-center gap-1.5" role="group" aria-label="Alarm sound">
                  {ALARM_SOUNDS.map((option) => {
                    const isActive = alarmSettings.sound === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        title={option.description}
                        aria-pressed={isActive}
                        onClick={() => void setAlarmSettings({ sound: option.id })}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                          isActive
                            ? "themed-accent-solid border-transparent"
                            : "border-white/25 hover:border-white/50 light:border-slate-300"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => void previewAlarm()}
                  className="mt-2 h-9 w-full rounded-xl border border-white/25 text-xs font-medium transition hover:border-white/50 light:border-slate-300"
                >
                  Test alarm
                </button>

                {audioBlockedReason() ? (
                  <p className="mt-1 text-[10px] text-amber-300 light:text-amber-700">
                    {audioBlockedReason()}
                  </p>
                ) : null}
              </>
            ) : null}

            <p className="mt-1.5 text-[10px] text-slate-400 light:text-slate-500">
              The alarm needs Structra open. While it is closed, reminder emails are sent
              instead - the browser cannot make a sound on its own.
            </p>
          </fieldset>

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
 * Small initials badge, used where a wider identity chip is rendered.
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
    <InitialBadge
      label={initialsOf(displayName, email)}
      className={`h-10 w-10 rounded-full ${className}`}
    />
  );
}

export { InitialBadge };