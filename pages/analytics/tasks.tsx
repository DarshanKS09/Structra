import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";
import { protectedPageProps, type AuthBootstrapProps } from "@/lib/auth/bootstrap";
import {
  getDetailedTaskAnalytics,
  type TaskAnalytics,
  type CompletionTrendPoint,
  type NamedBreakdown
} from "@/lib/data/analytics";
import { DonutChart } from "@/components/analytics/DonutChart";
import { TrendBars, BreakdownBars } from "@/components/analytics/TrendCharts";
import { NavBar } from "@/components/NavBar";
import { toDataError, type DataError } from "@/lib/data/errors";
import { useTaskStore } from "@/store/useTaskStore";
import { useThemeController } from "@/lib/hooks/useThemeController";

export default function TaskAnalyticsPage(props: AuthBootstrapProps) {
  return (
    <AuthProvider {...props}>
      <TaskAnalyticsView />
    </AuthProvider>
  );
}

function TaskAnalyticsView() {
  const { status, workspace, bootstrapping } = useAuth();
  const workspaceId = workspace?.id ?? null;
  const view = useTaskStore((s) => s.view);
  const setView = useTaskStore((s) => s.setView);
  // Appearance is owned by the shared controller; the page only needs it to
  // resolve the concrete theme. There is deliberately no theme control here -
  // Profile -> Appearance is the only entry point.
  useThemeController();

  const [summary, setSummary] = useState<TaskAnalytics | null>(null);
  const [trend, setTrend] = useState<CompletionTrendPoint[]>([]);
  const [priorities, setPriorities] = useState<NamedBreakdown[]>([]);
  const [categories, setCategories] = useState<NamedBreakdown[]>([]);
  // Bumped by any task write elsewhere, so analytics recalculate immediately.
  const taskRevision = useTaskStore((state) => state.taskRevision);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DataError | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getDetailedTaskAnalytics(workspaceId, new Date());
      setSummary(result.summary);
      setTrend(result.trend);
      setPriorities(result.priorities);
      setCategories(result.categories);
    } catch (caught) {
      setError(toDataError(caught, "Could not load your task analytics."));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (status !== "authenticated" || bootstrapping || !workspaceId) return;
    void load();
    // Re-read whenever a task is completed, edited or deleted anywhere else in
    // the app. Without this the page showed the numbers captured when it was
    // opened, which is why the donut and the completion percentage only changed
    // after a manual refresh.
  }, [status, bootstrapping, workspaceId, load, taskRevision]);


  if (status === "unknown" || bootstrapping) {
    return (
      <Centered>
        <p className="text-sm text-slate-400 light:text-slate-500">Loading your analytics…</p>
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


  return (
    <>
      <Head>
        <title>Task Analytics · Structra</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="relative z-10 mx-auto min-h-screen w-full max-w-4xl space-y-4 px-4 pb-16 pt-6 md:px-8">
        <NavBar
          view={view}
          onNavigate={setView}
        />

        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Task Analytics</h1>
            <p className="text-xs text-slate-400 light:text-slate-500">
              Derived live from your tasks in Supabase
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

        {loading && !summary ? (
          <Centered>
            <p className="text-sm text-slate-400 light:text-slate-500">Loading…</p>
          </Centered>
        ) : null}

        {summary ? (
          <>
            <Panel title="Overview">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
                <DonutChart
                  title="Task completion breakdown"
                  size={168}
                  centerValue={`${summary.completionRate}%`}
                  centerLabel="completed"
                  slices={[
                    { key: "completed", label: "Completed", value: summary.completed },
                    {
                      key: "pending",
                      label: "Pending",
                      value: Math.max(0, summary.pending - summary.overdue)
                    },
                    { key: "overdue", label: "Overdue", value: summary.overdue }
                  ]}
                />
                <dl className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric label="Total tasks" value={summary.total} />
                  <Metric label="Completed" value={summary.completed} tone="text-emerald-300 light:text-emerald-700" />
                  <Metric label="Pending" value={Math.max(0, summary.pending - summary.overdue)} tone="text-sky-300 light:text-sky-700" />
                  <Metric label="Overdue" value={summary.overdue} tone="text-rose-300 light:text-rose-700" />
                  <Metric label="Due today" value={summary.dueToday} tone="text-amber-300 light:text-amber-700" />
                  <Metric label="Due this week" value={summary.dueThisWeek} />
                </dl>
              </div>
              {summary.noDeadline > 0 ? (
                <p className="mt-3 text-[11px] text-slate-400 light:text-slate-500">
                  {summary.noDeadline} task{summary.noDeadline === 1 ? "" : "s"} predate the deadline
                  requirement and have no date. They count as pending but not as overdue.
                </p>
              ) : null}
            </Panel>

            <Panel
              title="How much did I finish?"
              subtitle="Tasks completed each day over the last 30 days"
            >
              <TrendBars
                title="Tasks completed per day"
                data={trend.map((point) => ({ label: point.day, value: point.completed }))}
                color="#34d399"
              />
            </Panel>

            <Panel title="How much is overdue?" subtitle="Incomplete tasks past their deadline">
              <p className="text-3xl font-bold tabular-nums">
                {summary.overdue}
                <span className="ml-2 text-sm font-normal text-slate-400 light:text-slate-500">
                  task{summary.overdue === 1 ? "" : "s"}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-400 light:text-slate-500">
                Completed tasks are never counted as overdue, even if their deadline has passed.
              </p>
            </Panel>

            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="By priority" subtitle="How your tasks were labelled">
                <BreakdownBars items={priorities} title="Tasks by priority" />
              </Panel>
              <Panel
                title="By category"
                subtitle={categories.length > 1 ? "A task can appear in more than one" : undefined}
              >
                <BreakdownBars items={categories} title="Tasks by category" />
              </Panel>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

function Panel({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-surface p-4 shadow-glass backdrop-blur-xl light:border-slate-300 light:bg-white/70 md:p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold tracking-tight md:text-lg">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-slate-400 light:text-slate-500">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "text-slate-100 light:text-slate-900"
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 light:border-slate-200 light:bg-white/60">
      <dt className="text-[11px] uppercase tracking-wide text-slate-400 light:text-slate-500">{label}</dt>
      <dd className={`text-xl font-bold tabular-nums ${value === 0 ? "text-slate-500" : tone}`}>{value}</dd>
    </div>
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