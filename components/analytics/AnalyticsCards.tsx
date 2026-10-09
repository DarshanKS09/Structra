"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { DonutChart } from "@/components/analytics/DonutChart";
import { TrendBars, TrendLine } from "@/components/analytics/TrendCharts";
import type { TaskAnalytics } from "@/lib/data/analytics";
import type { StudyAnalytics } from "@/lib/data/studyAnalytics";
import type { ReminderRow } from "@/lib/data/reminders";

/**
 * The Dashboard's analytics cards.
 *
 * ---------------------------------------------------------------------------
 * COMPACT BY DESIGN
 * ---------------------------------------------------------------------------
 * The Dashboard is a decision screen: "what needs my attention". These cards are
 * read-only summaries sized to answer one question each at a glance, and they
 * link to the detailed views rather than trying to show everything here. Adding
 * more charts to this screen would work against its whole purpose.
 *
 * ---------------------------------------------------------------------------
 * CLICKABLE CARDS
 * ---------------------------------------------------------------------------
 * The card and the chart are wrapped in one link so the whole surface is the
 * target, with a visible "View detailed analytics" affordance. That is what makes
 * "click the card to drill in" discoverable on a phone, where a small chart is
 * not obviously interactive.
 */

/** Shared frame so every card matches the existing Dashboard surfaces. */
function Card({
  title,
  subtitle,
  href,
  cta,
  children
}: {
  title: string;
  subtitle?: string;
  href?: string;
  cta?: string;
  children: React.ReactNode;
}) {
  const body = (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="rounded-3xl border border-border bg-surface p-4 shadow-glass backdrop-blur-xl light:border-slate-300 light:bg-white/70 md:p-5"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight md:text-lg">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-slate-400 light:text-slate-500">{subtitle}</p>
          ) : null}
        </div>
      </header>
      {children}
      {href ? (
        <p className="mt-3 text-xs font-semibold text-sky-300 light:text-sky-700">
          {cta ?? "View detailed analytics"} →
        </p>
      ) : null}
    </motion.section>
  );

  if (!href) return body;

  return (
    // A link wrapping the card makes the entire area the click target. The inner
    // div keeps the hover/focus affordance on the visual surface itself.
    <Link
      href={href}
      className="block rounded-3xl transition hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      {body}
    </Link>
  );
}

const Stat = ({ label, value, tone }: { label: string; value: number | string; tone: string }) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 light:border-slate-200 light:bg-white/60">
    <p className="text-[11px] uppercase tracking-wide text-slate-400 light:text-slate-500">{label}</p>
    <p className={`text-lg font-bold tabular-nums ${value === 0 ? "text-slate-500" : tone}`}>{value}</p>
  </div>
);

/**
 * TASK PROGRESS - completed / pending / overdue as a donut.
 *
 * "Overdue" is a property of an INCOMPLETE task, so the three slices are mutually
 * exclusive by construction: an overdue task is part of "pending", not an extra
 * slice on top of it. Adding it as a fourth slice would double-count and the
 * percentages would not sum to 100. So overdue is shown as a secondary metric
 * below the donut, which is also the clearer read.
 */
export function TaskProgressCard({
  analytics,
  href = "/analytics/tasks"
}: {
  analytics: TaskAnalytics;
  href?: string;
}) {
  const slices = [
    { key: "completed", label: "Completed", value: analytics.completed },
    // Pending here means "incomplete and not overdue", so the ring partitions
    // cleanly rather than double-counting.
    { key: "pending", label: "Pending", value: Math.max(0, analytics.pending - analytics.overdue) },
    { key: "overdue", label: "Overdue", value: analytics.overdue }
  ];

  return (
    <Card
      title="Task Progress"
      subtitle={
        analytics.total === 0
          ? "No tasks yet"
          : `${analytics.completionRate}% of ${analytics.total} task${analytics.total === 1 ? "" : "s"} completed`
      }
      href={href}
    >
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
        <DonutChart
          title="Task completion breakdown"
          slices={slices}
          size={140}
          centerValue={`${analytics.completionRate}%`}
          centerLabel="done"
        />
        <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-1">
          <Stat label="Completed" value={analytics.completed} tone="text-emerald-300 light:text-emerald-700" />
          <Stat label="Pending" value={Math.max(0, analytics.pending - analytics.overdue)} tone="text-sky-300 light:text-sky-700" />
          <Stat label="Overdue" value={analytics.overdue} tone="text-rose-300 light:text-rose-700" />
        </div>
      </div>
      {analytics.dueToday > 0 ? (
        <p className="mt-2 text-[11px] text-amber-300 light:text-amber-700">
          {analytics.dueToday} due today
        </p>
      ) : null}
      {analytics.noDeadline > 0 ? (
        <p className="mt-1 text-[11px] text-slate-400 light:text-slate-500">
          {analytics.noDeadline} task{analytics.noDeadline === 1 ? "" : "s"} without a deadline
        </p>
      ) : null}
    </Card>
  );
}

/** Seconds -> `"3h 20m"`, reusing the same formatting as the study planner. */
export const formatStudyTime = (seconds: number): string => {
  if (seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

/**
 * STUDY - total time and the split by subject.
 *
 * Weighting the donut by SECONDS rather than by session count is the whole point:
 * a single two-hour session outweighs three twenty-minute ones, and a chart that
 * counted rows would say otherwise.
 */
export function StudyProgressCard({
  analytics,
  href = "/analytics/study"
}: {
  analytics: StudyAnalytics;
  href?: string;
}) {
  /*
   * The card is linked even when there is no study time yet.
   *
   * It used to drop its `href` when `totalSeconds === 0`, which was reasonable
   * while "Study Analytics" was also a tab in the section navigation. Now that the
   * nav entry is gone, this card is the only way in - so suppressing it would make
   * the page unreachable for exactly the user who most needs to see the empty
   * state and learn what to log. The card already renders a "No completed
   * sessions yet" message, so the target is still meaningful.
   */
  const slices = analytics.bySubject.map((entry) => ({
    key: entry.subjectId ?? "unclassified",
    label: entry.label,
    value: entry.totalSeconds
  }));

  return (
    <Card
      title="Study"
      subtitle={
        analytics.totalSeconds === 0
          ? "No completed sessions yet"
          : `${formatStudyTime(analytics.monthSeconds)} this month`
      }
      href={href}
    >
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
        <DonutChart
          title="Study time by subject"
          slices={slices}
          size={140}
          formatValue={formatStudyTime}
          centerValue={formatStudyTime(analytics.monthSeconds)}
          centerLabel="this month"
        />
        <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-1">
          <Stat label="Today" value={formatStudyTime(analytics.todaySeconds)} tone="text-violet-300 light:text-violet-700" />
          <Stat label="This week" value={formatStudyTime(analytics.weekSeconds)} tone="text-indigo-300 light:text-indigo-700" />
          <Stat label="Sessions" value={analytics.completedSessions} tone="text-slate-200 light:text-slate-800" />
        </div>
      </div>
      {analytics.openSessions > 0 ? (
        <p className="mt-2 text-[11px] text-emerald-300 light:text-emerald-700">
          {analytics.openSessions} session{analytics.openSessions === 1 ? "" : "s"} running now
        </p>
      ) : null}
    </Card>
  );
}

/** GROCERIES - the current list, with a link into the history view. */
export function GrocerySummaryCard({
  activeCount,
  historyCount,
  href = "/grocery-history"
}: {
  activeCount: number;
  historyCount: number;
  href?: string;
}) {
  return (
    <Card title="Groceries" subtitle="Current list" href={historyCount > 0 ? href : undefined} cta="Previous grocery lists →">
      <p className="text-2xl font-bold tabular-nums">
        {activeCount}
        <span className="ml-2 text-sm font-normal text-slate-400 light:text-slate-500">
          item{activeCount === 1 ? "" : "s"} to buy
        </span>
      </p>
      {historyCount > 0 ? (
        <p className="mt-1 text-xs text-slate-400 light:text-slate-500">
          {historyCount} previous list{historyCount === 1 ? "" : "s"} kept
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-400 light:text-slate-500">
          Finish a list to keep it as history
        </p>
      )}
    </Card>
  );
}

/**
 * REMINDERS - tasks whose reminder instant has already passed.
 *
 * This is the in-app delivery channel: the rows are read from the database on
 * every Dashboard load, so a reminder survives refresh and logout/login with no
 * client-side timer. It is honest about its limit - it surfaces while the app is
 * open, and the emailed copy is dispatched by the scheduled server job.
 */
export function ReminderCard({
  reminders,
  onDismiss
}: {
  reminders: ReminderRow[];
  onDismiss: (id: string) => void;
}) {
  if (reminders.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
      aria-live="polite"
      className="rounded-3xl border border-amber-400/40 bg-amber-500/10 p-4 light:border-amber-300 light:bg-amber-100"
    >
      <h2 className="mb-2 text-sm font-semibold text-amber-200 light:text-amber-800">
        {reminders.length} task reminder{reminders.length === 1 ? "" : "s"}
      </h2>
      <ul className="space-y-1.5">
        {reminders.map((reminder) => (
          <li key={reminder.id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{reminder.title}</span>
            <span className="shrink-0 text-amber-300/90 light:text-amber-700">
              {reminder.due_at ? `due ${new Date(reminder.due_at).toLocaleString()}` : ""}
            </span>
            <button
              type="button"
              onClick={() => onDismiss(reminder.id)}
              className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] underline underline-offset-2"
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

/** Trend charts reused by the detailed analytics pages. */
export { TrendBars, TrendLine };