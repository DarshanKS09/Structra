"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { modeLabels, type ListMode } from "@/types/taskTypes";
import { ProfileMenu } from "@/components/ProfileMenu";
import type { AppView } from "@/store/useTaskStore";

/**
 * The application navigation bar.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHARED
 * ---------------------------------------------------------------------------
 * The Dashboard and the section screens both need the same navigation. It was
 * previously duplicated inside the page, which is how the two copies drifted -
 * and it is exactly how the Dashboard would have ended up missing from the
 * mobile menu. One component, used twice, cannot drift.
 *
 * ---------------------------------------------------------------------------
 * ORDER
 * ---------------------------------------------------------------------------
 * `Dashboard` is always the first item, on desktop and on mobile, because it is
 * the home screen. Every section follows in its existing order, so nothing that
 * used to be reachable stops being reachable.
 */

const MODE_ICONS: Record<ListMode, string> = {
  task: "✓",
  grocery: "◉",
  habit: "↻",
  study: "✦",
  fitness: "⚡",
  shopping: "◈",
  meeting: "✎"
};

type NavBarProps = {
  view: AppView;
  onNavigate: (view: AppView) => void;
  /** Short theme name + swatch class, owned by the page. */
  themeLabel: string;
  themeClassName: string;
  onCycleTheme: () => void;
};

export function NavBar({
  view,
  onNavigate,
  themeLabel,
  themeClassName,
  onCycleTheme
}: NavBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close the mobile sheet on an outside click or Escape, so it cannot be left
  // covering the content after a tap elsewhere.
  useEffect(() => {
    if (!mobileOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setMobileOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  const isActive = (target: AppView) => view === target;

  const navItemClass = (active: boolean) =>
    `h-10 rounded-xl px-3 text-sm ${
      active
        ? "themed-accent-solid font-semibold"
        : "border border-white/20 transition hover:border-white/40 hover:bg-white/10 light:border-slate-300"
    }`;

  const go = (target: AppView) => {
    onNavigate(target);
    setMobileOpen(false);
  };

  return (
    <div ref={wrapperRef} className="space-y-3">
      {/* --- desktop bar -------------------------------------------------- */}
      <div className="hidden items-center justify-between md:flex">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-300 light:text-slate-600">
            {view === "dashboard" ? "Dashboard" : view === "modes" ? "All Sections" : modeLabels[view]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ProfileMenu />
          <motion.button
            type="button"
            onClick={onCycleTheme}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.93 }}
            className={`h-10 w-10 rounded-full text-xs font-semibold ${themeClassName}`}
            title="Change Theme"
            aria-label="Change theme"
          >
            {themeLabel}
          </motion.button>
        </div>
      </div>

      <nav aria-label="Sections" className="hidden gap-2 overflow-x-auto pb-1 md:flex">
        <motion.button
          type="button"
          onClick={() => go("dashboard")}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          aria-current={isActive("dashboard") ? "page" : undefined}
          className={navItemClass(isActive("dashboard"))}
        >
          Dashboard
        </motion.button>
        {(Object.keys(modeLabels) as ListMode[]).map((mode) => (
          <motion.button
            key={mode}
            type="button"
            onClick={() => go(mode)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            aria-current={isActive(mode) ? "page" : undefined}
            className={navItemClass(isActive(mode))}
          >
            {modeLabels[mode]}
          </motion.button>
        ))}
        <motion.button
          type="button"
          onClick={() => go("modes")}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          aria-current={isActive("modes") ? "page" : undefined}
          className={navItemClass(isActive("modes"))}
        >
          All Sections
        </motion.button>
      </nav>

      {/* --- mobile bar ---------------------------------------------------- */}
      <div className="md:hidden">
        <div className="flex items-center justify-between">
          <div className="relative">
            <motion.button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              whileTap={{ scale: 0.97 }}
              aria-expanded={mobileOpen}
              aria-label="Open navigation menu"
              className="flex h-11 w-14 items-center justify-center rounded-xl border border-white/20 bg-white/10"
            >
              <span className="space-y-1">
                <span className="block h-0.5 w-4 rounded-full bg-slate-200" />
                <span className="block h-0.5 w-4 rounded-full bg-slate-200" />
                <span className="block h-0.5 w-4 rounded-full bg-slate-200" />
              </span>
            </motion.button>

            <AnimatePresence>
              {mobileOpen && (
                <motion.nav
                  aria-label="Sections"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 top-12 z-30 max-h-[70vh] w-56 overflow-y-auto rounded-xl border border-white/20 bg-slate-900/95 p-1.5 backdrop-blur-xl"
                >
                  <button
                    type="button"
                    onClick={() => go("dashboard")}
                    className={`mb-1 block h-9 w-full rounded-lg px-2 text-left text-xs ${
                      isActive("dashboard")
                        ? "themed-accent-solid font-semibold"
                        : "text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    ▦ Dashboard
                  </button>
                  {(Object.keys(modeLabels) as ListMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => go(mode)}
                      className={`mb-1 block h-9 w-full rounded-lg px-2 text-left text-xs ${
                        isActive(mode)
                          ? "themed-accent-solid font-semibold"
                          : "text-slate-200 hover:bg-white/10"
                      }`}
                    >
                      <span className="mr-1.5">{MODE_ICONS[mode]}</span>
                      {modeLabels[mode]}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => go("modes")}
                    className={`mb-1 block h-9 w-full rounded-lg px-2 text-left text-xs ${
                      isActive("modes")
                        ? "themed-accent-solid font-semibold"
                        : "text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    All Sections
                  </button>
                </motion.nav>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-2">
            <ProfileMenu />
            <motion.button
              type="button"
              onClick={onCycleTheme}
              whileTap={{ scale: 0.92 }}
              className={`h-11 w-11 rounded-full text-xs font-semibold ${themeClassName}`}
              title="Change Theme"
              aria-label="Change theme"
            >
              {themeLabel}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The section targets offered by the Dashboard's quick-add. */
export const QUICK_ADD_MODES: { mode: ListMode; label: string; icon: string }[] = (
  Object.keys(modeLabels) as ListMode[]
).map((mode) => ({ mode, label: modeLabels[mode], icon: MODE_ICONS[mode] }));