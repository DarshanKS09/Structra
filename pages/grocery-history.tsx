import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";
import { protectedPageProps, type AuthBootstrapProps } from "@/lib/auth/bootstrap";
import {
  getGroceryHistory,
  listGroceryItems,
  copyGroceryListItems,
  describeCopyResult,
  ensureDefaultGroceryList,
  type GroceryHistoryEntry
} from "@/lib/data/groceries";
import type { GroceryItemRow } from "@/lib/data/types";
import { NavBar } from "@/components/NavBar";
import { toDataError, type DataError } from "@/lib/data/errors";
import { useTaskStore } from "@/store/useTaskStore";
import { useThemeController } from "@/lib/hooks/useThemeController";

/**
 * Grocery history.
 *
 * ---------------------------------------------------------------------------
 * WHY HISTORY IS READ, NEVER DESTROYED
 * ---------------------------------------------------------------------------
 * A finished trip is an archived `grocery_lists` row with `completed_at` set, and
 * its items are untouched. That is the whole mechanism: completing a list
 * preserves it rather than deleting what was bought, so this page can still show
 * last week's shop after a refresh or a logout/login.
 *
 * The one action that mutates is an explicit, opt-in "copy to current list",
 * which only re-adds items that were never purchased. Old items are never pushed
 * back automatically.
 */
export default function GroceryHistoryPage(props: AuthBootstrapProps) {
  return (
    <AuthProvider {...props}>
      <GroceryHistoryView />
    </AuthProvider>
  );
}

function GroceryHistoryView() {
  const { status, workspace, bootstrapping } = useAuth();
  const workspaceId = workspace?.id ?? null;
  const view = useTaskStore((s) => s.view);
  const setView = useTaskStore((s) => s.setView);
  // Copying writes to the ACTIVE list, which the Grocery List section renders
  // from its own copy of the data. This is how that section learns to re-read.
  const bumpTaskRevision = useTaskStore((s) => s.bumpTaskRevision);
  // Appearance is owned by the shared controller; the page only needs it to
  // resolve the concrete theme. There is deliberately no theme control here -
  // Profile -> Appearance is the only entry point.
  useThemeController();

  const [entries, setEntries] = useState<GroceryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DataError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Which trip is open. Null means the list view, so the page opens on the
  // summary rather than deep in a detail view.
  const [openId, setOpenId] = useState<string | null>(null);
  const [openItems, setOpenItems] = useState<GroceryItemRow[]>([]);
  const [openLoading, setOpenLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      setEntries(await getGroceryHistory(workspaceId));
    } catch (caught) {
      setError(toDataError(caught, "Could not load your grocery history."));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (status !== "authenticated" || bootstrapping || !workspaceId) return;
    void load();
  }, [status, bootstrapping, workspaceId, load]);

  const openTrip = useCallback(async (entry: GroceryHistoryEntry) => {
    setOpenId(entry.list.id);
    setOpenLoading(true);
    setNotice(null);
    try {
      setOpenItems(await listGroceryItems(entry.list.id, { filter: "all" }));
    } catch (caught) {
      setError(toDataError(caught, "Could not open that list."));
    } finally {
      setOpenLoading(false);
    }
  }, []);

  const copyTrip = useCallback(async () => {
    if (!workspaceId || !openId) return;
    setCopying(true);
    setError(null);
    setNotice(null);
    try {
      const active = await ensureDefaultGroceryList(workspaceId);
      const result = await copyGroceryListItems(openId, active.id);

      // The Grocery List section is a different page holding its own copy of the
      // active list. Without this signal it would still be showing the pre-copy
      // list when the user navigates back - and the obvious response to that
      // would be to copy a second time, creating the duplicates this guards
      // against.
      bumpTaskRevision();

      // The message is built from the copy's own counts rather than a generic
      // "done", so "nothing new", "already there" and a genuine unit conflict
      // each read differently. Silently collapsing them would make it impossible
      // to tell a working reuse from a no-op.
      setNotice(describeCopyResult(result));
    } catch (caught) {
      setError(toDataError(caught, "Could not copy that list."));
    } finally {
      setCopying(false);
    }
  }, [workspaceId, openId, bumpTaskRevision]);


  if (status === "unknown" || bootstrapping) {
    return (
      <Centered>
        <p className="text-sm text-slate-400 light:text-slate-500">Loading your history…</p>
      </Centered>
    );
  }
  if (status === "unauthenticated") {
    return (
      <Centered>
        <p className="text-sm text-slate-400 light:text-slate-500">Session ended.</p>
        <Link href="/login" className="themed-accent-solid mt-3 rounded-xl px-4 py-2 text-sm font-semibold">
          Sign in
        </Link>
      </Centered>
    );
  }

  const open = entries.find((entry) => entry.list.id === openId);

  return (
    <>
      <Head>
        <title>Grocery History · Structra</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="relative z-10 mx-auto min-h-screen w-full max-w-3xl space-y-4 px-4 pb-16 pt-6 md:px-8">
        <NavBar
          view={view}
          onNavigate={setView}
        />

        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Grocery History</h1>
            <p className="text-xs text-slate-400 light:text-slate-500">
              Every finished trip, kept with its items
            </p>
          </div>
        </header>

        {error ? (
          <div role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <p>{error.message}</p>
            <button type="button" onClick={() => void load()} className="mt-1 text-xs underline">
              Try again
            </button>
          </div>
        ) : null}

        {notice ? (
          <p className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {notice}
          </p>
        ) : null}

        {/* --- a trip is open ------------------------------------------- */}
        {open ? (
          <section className="rounded-3xl border border-border bg-surface p-4 shadow-glass backdrop-blur-xl light:border-slate-300 light:bg-white/70 md:p-5">
            <header className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  className="mb-1 text-xs text-sky-300 light:text-sky-700"
                >
                  ← All trips
                </button>
                <h2 className="text-lg font-semibold">
                  {new Date(open.list.completed_at ?? open.list.created_at).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    year: "numeric"
                  })}
                </h2>
                <p className="text-xs text-slate-400 light:text-slate-500">
                  {open.itemCount} item{open.itemCount === 1 ? "" : "s"} · {open.completedCount} bought
                </p>
              </div>
              <button
                type="button"
                onClick={() => void copyTrip()}
                disabled={copying}
                className="shrink-0 rounded-xl border border-white/25 px-3 py-2 text-xs font-medium transition hover:border-white/50 disabled:opacity-50 light:border-slate-300"
              >
                {copying ? "Copying…" : "Copy to current"}
              </button>
            </header>

            {openLoading ? (
              <p className="text-xs text-slate-400 light:text-slate-500">Loading items…</p>
            ) : openItems.length === 0 ? (
              <p className="text-xs text-slate-400 light:text-slate-500">
                This trip has no items recorded.
              </p>
            ) : (
              <ul className="divide-y divide-white/10 light:divide-slate-200">
                {openItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-2 text-xs">
                    {/*
                      Historical item names render in the inherited body colour.

                      They used to carry `line-through` plus a muted tone whenever
                      the item was bought, which is right for a live checklist but
                      wrong for a receipt: a finished trip is a record of what was
                      purchased, and striking every line through made the list hard
                      to read precisely when someone wants to review it.

                      The completion state is NOT lost - it is still stored on the
                      row, still counted in the "N bought" line in the header, and
                      the active Grocery List keeps its own tick-through styling
                      untouched. This is presentation for the history view only.
                    */}
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.quantity ? (
                      <span className="shrink-0 tabular-nums text-slate-400 light:text-slate-500">
                        {item.quantity} {item.unit ?? ""}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
            {loading ? (
              <Centered>
                <p className="text-sm text-slate-400 light:text-slate-500">Loading…</p>
              </Centered>
            ) : entries.length === 0 ? (
              <section className="rounded-3xl border border-border bg-surface p-6 text-center shadow-glass light:border-slate-300 light:bg-white/70">
                <p className="text-sm text-slate-400 light:text-slate-500">
                  No finished trips yet.
                </p>
                <p className="mt-1 text-xs text-slate-400 light:text-slate-500">
                  Use “Finish list” in the Grocery List section to archive the current shop — its
                  items are kept, not deleted.
                </p>
                <Link
                  href="/"
                  onClick={() => setView("grocery")}
                  className="themed-accent-solid mt-4 inline-flex rounded-xl px-4 py-2 text-sm font-semibold"
                >
                  Open Grocery List
                </Link>
              </section>
            ) : (
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li key={entry.list.id}>
                    <button
                      type="button"
                      onClick={() => void openTrip(entry)}
                      className="flex w-full items-center gap-3 rounded-3xl border border-border bg-surface px-4 py-3 text-left shadow-glass transition hover:border-white/40 light:border-slate-300 light:bg-white/70"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {new Date(entry.list.completed_at ?? entry.list.created_at).toLocaleDateString(
                            undefined,
                            { day: "numeric", month: "long", year: "numeric" }
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-400 light:text-slate-500">
                          {entry.itemCount} item{entry.itemCount === 1 ? "" : "s"} ·{" "}
                          {entry.completedCount} bought
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                        Completed
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
      {children}
    </main>
  );
}

export const getServerSideProps: GetServerSideProps<AuthBootstrapProps> = protectedPageProps;