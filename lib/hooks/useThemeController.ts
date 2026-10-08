"use client";

import { useCallback, useEffect } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { setTheme as persistTheme } from "@/lib/data/account";
import {
  useTaskStore,
  type Appearance,
  type DarkAccent,
  type ThemeVariant
} from "@/store/useTaskStore";

/**
 * The single owner of Structra's appearance.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Every page used to apply the theme itself: each one read `theme` from the
 * store, ran its own `classList.remove(...) / add(...)` effect and mirrored the
 * value to `user_settings`. Four copies of that is how the analytics pages and
 * the Dashboard drifted, and it is why a theme control had to be duplicated into
 * every header.
 *
 * The resolution rule lives once, here:
 *
 *   appearance "light" -> the Light theme
 *   appearance "dark"  -> the chosen dark accent (Ocean or Crimson)
 *
 * There is no media query any more. "System" was removed so the setting always
 * states what is on screen; a control whose label can be silently overridden by
 * the operating system is not a control. A user whose OS is dark and who wants
 * that simply leaves the appearance on Dark.
 */
/**
 * Resolves the concrete theme to apply.
 *
 * Two appearance options and two dark accents, so the rule is one line:
 * Light always means the light theme, Dark means whichever dark accent is
 * selected. Exported and pure so it can be verified directly rather than by
 * reading the effect.
 */
export const resolveTheme = (
  appearance: Appearance,
  darkAccent: DarkAccent
): ThemeVariant => (appearance === "light" ? "light" : darkAccent);

export function useThemeController(): {
  /** The concrete theme currently applied to the DOM. */
  theme: ThemeVariant;
  appearance: Appearance;
  darkAccent: DarkAccent;
  setAppearance: (next: Appearance) => void;
  setDarkAccent: (next: DarkAccent) => void;
} {
  const { user } = useAuth();
  const theme = useTaskStore((state) => state.theme);
  const appearance = useTaskStore((state) => state.appearance);
  const darkAccent = useTaskStore((state) => state.darkAccent);
  const applyTheme = useTaskStore((state) => state.applyTheme);

  // The one place the theme class is written.
  const resolved = resolveTheme(appearance, darkAccent);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-ocean", "theme-crimson", "theme-light");
    root.classList.add(`theme-${resolved}`);
    // The colour is a SEPARATE axis from the appearance, so it is a separate
    // class. Without this the light appearance would be one fixed accent and
    // "Ocean / Crimson" would do nothing while in Light.
    //
    // In a dark appearance the `theme-*` rule already matches the accent, so
    // adding `accent-*` there changes nothing - which is what keeps Dark+Ocean
    // and Dark+Crimson rendering exactly as before.
    root.classList.remove("accent-ocean", "accent-crimson");
    root.classList.add(`accent-${darkAccent}`);
    // `color-scheme` tells the browser which built-in widget palette to use, so
    // a native scrollbar or select in a dark theme is not rendered light.
    root.style.colorScheme = resolved === "light" ? "light" : "dark";
  }, [resolved, darkAccent]);

  // Mirrored to the existing Supabase-backed `user_settings` so the preference
  // follows the account rather than only this browser. Failure is deliberately
  // swallowed: a theme sync must never block or break the app.
  useEffect(() => {
    if (!user) return;
    void persistTheme(user.id, resolved as "ocean" | "crimson" | "light").catch(() => undefined);
  }, [user, resolved]);

  const setAppearance = useCallback(
    (next: Appearance) => applyTheme({ appearance: next }),
    [applyTheme]
  );
  const setDarkAccent = useCallback(
    (next: DarkAccent) => applyTheme({ appearance, accent: next }),
    [applyTheme, appearance]
  );

  return { theme: resolved, appearance, darkAccent, setAppearance, setDarkAccent };
}