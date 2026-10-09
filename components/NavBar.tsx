"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
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

/**
 * Decides what a navigation click should actually DO.
 *
 * Exported and pure so the routing rule can be verified without a browser.
 *
 * Sections are not routes - they are store state rendered by `pages/index.tsx` -
 * so on the home page setting the view IS the navigation. On any other page the
 * same `setView` changes an in-memory value nothing there reads, so the click must
 * ALSO route home, where that view is actually rendered. Skipping that second half
 * is why clicking "Dashboard" on the analytics pages appeared to do nothing.
 *
 * `view` is deliberately not persisted, so it survives `router.push` (a
 * client-side transition) but not a later full reload - which is exactly the
 * intended behaviour, since a returning user still lands on the Dashboard.
 */
export const resolveNavAction = (
  isHome: boolean,
  target: AppView
): { view: AppView; routeHome: boolean } => ({ view: target, routeHome: !isHome });

const MODE_ICONS: Record<ListMode, string> = {
  task: "✓",
  grocery: "◉",
  habit: "↻",
  study: "✦",
  fitness: "⚡",
  shopping: "◈",
  meeting: "✎"
};

/** Real pages that live alongside the section modes. */
/**
 * Real pages that sit alongside the section modes.
 *
 * Task Analytics and Study Analytics are deliberately NOT here. They used to be,
 * which made the section row read as "eight sections" when they are reports about
 * the sections rather than places to put things. They are reached from the
 * Dashboard cards instead - "View detailed analytics" under the task and study
 * charts - which keeps the section list about doing work and the reports one hop
 * away from the numbers they explain.
 *
 * Grocery history stays: it is a destination in its own right (a place to open a
 * past trip and copy from it), not a report, and it is also linked from the
 * Dashboard's groceries card.
 */
const EXTRA_PAGES: { href: string; label: string }[] = [
  { href: "/grocery-history", label: "Grocery History" }
];

type NavBarProps = {
  view: AppView;
  onNavigate: (view: AppView) => void;
};

/**
 * The application navigation bar.
 *
 * The theme button that used to live here has moved into Profile -> Appearance.
 * Two consequences worth recording:
 *
 *   - The requirement is that Profile is the only intentional entry point to the
 *     theme selector, and a header swatch is a second one.
 *   - On mobile that swatch sat immediately beside the avatar as another circle
 *     with light text in the middle, which read as a duplicate avatar. Removing
 *     it fixes the visual duplication at its source rather than hiding it.
 */
export function NavBar({ view, onNavigate }: NavBarProps) {
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

  // Whether this bar is being rendered by the home page - the only page that can
  // turn a section target into visible content.
  const router = useRouter();
  const isHome = router.pathname === "/";

  const navItemClass = (active: boolean) =>
    `h-10 rounded-xl px-3 text-sm ${
      active
        ? "themed-accent-solid font-semibold"
        : "border border-white/20 transition hover:border-white/40 hover:bg-white/10 light:border-slate-300"
    }`;

  /**
   * Navigates to a section target.
   *
   * ---------------------------------------------------------------------------
   * WHY THE ROUTER CHECK IS HERE
   * ---------------------------------------------------------------------------
   * Sections are not routes. They are Zustand state rendered by `pages/index.tsx`,
   * so on the home page `onNavigate` alone is correct and instant.
   *
   * But this bar is also rendered by `/analytics/tasks`, `/analytics/study` and
   * `/grocery-history`, and those pages pass the SAME `setView`. On them
   * `onNavigate` changed an in-memory value that nothing on the page reads, so
   * clicking "Dashboard" did nothing at all and the user stayed on Task Analytics.
   * `view` is deliberately not persisted either, so the intent evaporated on the
   * next navigation.
   *
   * So: on the home page, set the view directly. Anywhere else, set it AND go to
   * `/`, where that view is actually rendered. Because `router.push` is a
   * client-side transition, the non-persisted `view` survives the handoff, while a
   * later full reload still lands on the Dashboard - which is the existing
   * behaviour for returning users and must not change.
   */
  const go = (target: AppView) => {
    const action = resolveNavAction(isHome, target);
    onNavigate(action.view);
    setMobileOpen(false);
    if (action.routeHome) router.push("/");
  };

  return (
    <div ref={wrapperRef} className="space-y-3">
      {/*
        ONE bar, ONE avatar.

        This used to be two separate bars - a desktop one and a mobile one - each
        with its own `<ProfileMenu />`. Tailwind's responsive `display` kept only
        one visible, so it looked correct, but two instances were mounted: two
        profile popovers, two hidden file inputs, and two subscriptions to the
        appearance setting. The mobile bar also carried a second round control
        beside the avatar (the theme swatch), which is what read on a phone as a
        duplicated avatar.

        Collapsing to a single bar makes "exactly one avatar" true of the
        component tree and not merely of the rendered pixels. The left-hand slot
        simply shows the current-section label on desktop and the menu button on
        mobile, so the right-hand slot is the profile control at every width.
      */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="hidden text-sm font-medium text-slate-300 light:text-slate-600 md:inline">
            {view === "dashboard" ? "Dashboard" : view === "modes" ? "All Sections" : modeLabels[view]}
          </span>

          <div className="relative md:hidden">
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
        </div>

        <ProfileMenu />
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

        {/*
          Extra pages are real routes, not modes, so they are links rather than new
          members of the `ListMode` union. Keeping them separate means adding a
          page never widens that union or touches a list component.

          These are Next `<Link>`s. They were plain `<a href>`, which forces a
          full document reload: every click tore down the React tree, re-ran
          getServerSideProps and re-fetched everything from scratch. That is the
          transition lag, and it is also why navigating felt unreliable - a full
          reload shows whatever the new page's first render produces, with no
          shared client state to keep it consistent with where you came from.
          Client-side routing keeps the session, the auth state and the store, so
          the destination renders from data already in memory.
        */}
        {EXTRA_PAGES.map((page) => (
          <Link key={page.href} href={page.href} legacyBehavior={false}>
            <motion.span
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              className="flex h-10 cursor-pointer items-center rounded-xl border border-white/20 px-3 text-sm transition hover:border-white/40 hover:bg-white/10 light:border-slate-300"
            >
              {page.label}
            </motion.span>
          </Link>
        ))}
      </nav>

    </div>
  );
}

/** The section targets offered by the Dashboard's quick-add. */
export const QUICK_ADD_MODES: { mode: ListMode; label: string; icon: string }[] = (
  Object.keys(modeLabels) as ListMode[]
).map((mode) => ({ mode, label: modeLabels[mode], icon: MODE_ICONS[mode] }));