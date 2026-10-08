import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";
import { protectedPageProps, type AuthBootstrapProps } from "@/lib/auth/bootstrap";
import {
  getStudyAnalytics,
  getStudyTrend,
  type StudyAnalytics,
  type StudyTrendPoint
} from "@/lib/data/studyAnalytics";
import { DonutChart } from "@/components/analytics/DonutChart";
import { TrendLine, BreakdownBars } from "@/components/analytics/TrendCharts";
import { formatStudyTime } from "@/components/analytics/AnalyticsCards";
import { NavBar } from "@/components/NavBar";
import { toDataError, type DataError } from "@/lib/data/errors";
import { useTaskStore } from "@/store/useTaskStore";
import { useThemeController } from "@/lib/hooks/useThemeController";

export default function StudyAnalyticsPage(props: AuthBootstrapProps) {
  return (
    <AuthProvider {...props}>
      <StudyAnalyticsView />
    </AuthProvider>
  );
}

function StudyAnalyticsView() {
  const { status, user, workspace, bootstrapping } = useAuth();
  const workspaceId = workspace?.id ?? null;
  const userId = user?.id ?? null;
  const view = useTaskStore((s) => s.view);
  const setView = useTaskStore((s) => s.setView);
  // Appearance is owned by the shared controller; the page only needs it to
  // resolve the concrete theme. There is deliberately no theme control here -
  // Profile -> Appearance is the only entry point.
  useThemeController();

  const [analytics, setAnalytics] = useState<StudyAnalytics | null>(null);
  const [trend, setTrend] = useState<StudyTrendPoint[]>([]);
  const taskRevision = useTaskStore((state) => state.taskRevision);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DataError | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const [summary, daily] = await Promise.all([
        getStudyAnalytics(workspaceId, userId, new Date()),
        getStudyTrend(workspaceId, userId, 30, new Date())
      ]);
      setAnalytics(summary);
      setTrend(daily);
    } catch (caught) {
      setError(toDataError(caught, "Could not load your study analytics."));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, userId]);

  useEffect(() => {
    if (status !== "authenticated" || bootstrapping || !workspaceId || !userId) return;
    void load();
    // Starting or stopping a session changes the totals, so re-read rather than
    // showing figures captured when the page was opened.
  }, [status, bootstrapping, workspaceId, userId, load, taskRevision]);


  if (status === "unknown" || bootstrapping) {
    return (
      <Centered>
        <p className="text-sm text-slate-400 light:text-slate-500">Loading your study analytics…</p>
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
        <title>Study Analytics · Structra</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="relative z-10 mx-auto min-h-screen w-full max-w-4xl space-y-4 px-4 pb-16 pt-6 md:px-8">
        <NavBar
          view={view}
          onNavigate={setView}
        />

        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Study Analytics</h1>
            <p className="text-xs text-slate-400 light:text-slate-500">
              Actual session durations from Supabase
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

        {loading && !analytics ? (
          <Centered>
            <p className="text-sm text-slate-400 light:text-slate-500">Loading…</p>
          </Centered>
        ) : null}

        {analytics ? (
          <>
            {/*
              Empty state is a real state, not an error: a user who has not
              studied yet should see an explanation rather than an empty chart
              that looks broken.
            */}
            {analytics.completedSessions === 0 ? (
              <Panel title="No study sessions yet">
                <p className="text-sm text-slate-400 light:text-slate-500">
                  Start and stop a session in the Study Planner and your time will appear here.
                  A session that is still running is not counted until it ends, because time has
                  not been spent yet.
                </p>
                <Link
                  href="/"
                  onClick={() => setView("study")}
                  className="themed-accent-solid mt-3 inline-flex rounded-xl px-4 py-2 text-sm font-semibold"
                >
                  Open Study Planner
                </Link>
              </Panel>
            ) : (
              <>
                <Panel title="Time by subject" subtitle="Weighted by real duration, not session count">
                  <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
                    <DonutChart
                      title="Study time by subject"
                      size={176}
                      formatValue={formatStudyTime}
                      centerValue={formatStudyTime(analytics.totalSeconds)}
                      centerLabel="total"
                      slices={analytics.bySubject.map((entry) => ({
                        key: entry.subjectId ?? "unclassified",
                        label: entry.label,
                        value: entry.totalSeconds
                      }))}
                    />
                    <dl className="grid w-full grid-cols-2 gap-2">
                      <Metric label="Total" value={formatStudyTime(analytics.totalSeconds)} />
                      <Metric label="Today" value={formatStudyTime(analytics.todaySeconds)} tone="text-violet-300 light:text-violet-700" />
                      <Metric label="This week" value={formatStudyTime(analytics.weekSeconds)} tone="text-indigo-300 light:text-indigo-700" />
                      <Metric label="This month" value={formatStudyTime(analytics.monthSeconds)} tone="text-sky-300 light:text-sky-700" />
                      <Metric label="Sessions" value={analytics.completedSessions} />
                      <Metric
                        label="Avg session"
                        value={formatStudyTime(analytics.averageSessionSeconds)}
                      />
                    </dl>
                  </div>
                  {analytics.openSessions > 0 ? (
                    <p className="mt-3 text-[11px] text-emerald-300 light:text-emerald-700">
                      {analytics.openSessions} session{analytics.openSessions === 1 ? "" : "s"}{" "}
                      still running — excluded until they end.
                    </p>
                  ) : null}
                </Panel>

                {analytics.topSubject ? (
                  <Panel title="What am I studying most?" subtitle="By total time">
                    <p className="text-2xl font-bold">{analytics.topSubject.label}</p>
                    <p className="mt-1 text-sm text-slate-400 light:text-slate-500">
                      {formatStudyTime(analytics.topSubject.totalSeconds)} across{" "}
                      {analytics.topSubject.sessionCount} session
                      {analytics.topSubject.sessionCount === 1 ? "" : "s"}
                    </p>
                  </Panel>
                ) : null}

                <Panel
                  title="Am I studying consistently?"
                  subtitle="Time per day over the last 30 days"
                >
                  <TrendLine
                    title="Study time per day"
                    data={trend.map((point) => ({ label: point.day, value: point.totalSeconds }))}
                    formatValue={formatStudyTime}
                    color="#a78bfa"
                  />
                </Panel>

                {analytics.bySubject.length > 0 ? (
                  <Panel title="Time per subject" subtitle="Seconds spent, largest first">
                    <BreakdownBars
                      title="Study seconds by subject"
                      items={analytics.bySubject.map((entry) => ({
                        label: entry.label,
                        count: entry.totalSeconds
                      }))}
                      formatValue={formatStudyTime}
                    />
                  </Panel>
                ) : null}

                <Panel title="Recent sessions" subtitle="Most recent first">
                  {analytics.recentSessions.length === 0 ? (
                    <p className="text-sm text-slate-400 light:text-slate-500">Nothing yet.</p>
                  ) : (
                    <ul className="divide-y divide-white/10 light:divide-slate-200">
                      {analytics.recentSessions.slice(0, 10).map((session) => (
                        <li
                          key={session.id}
                          className="flex items-center gap-3 py-2 text-xs first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{session.subject}</span>
                            {session.topic ? (
                              <span className="block truncate text-slate-400 light:text-slate-500">
                                {session.topic}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 tabular-nums text-slate-400 light:text-slate-500">
                            {new Date(session.startedAt).toLocaleDateString()}
                          </span>
                          <span className="w-16 shrink-0 text-right font-semibold tabular-nums">
                            {formatStudyTime(session.durationSeconds)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </>
            )}
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
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 light:border-slate-200 light:bg-white/60">
      <dt className="text-[11px] uppercase tracking-wide text-slate-400 light:text-slate-500">{label}</dt>
      <dd className={`text-lg font-bold tabular-nums ${tone}`}>{value}</dd>
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