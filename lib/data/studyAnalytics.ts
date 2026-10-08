import { db } from "@/lib/data/client";
import { toDataError } from "@/lib/data/errors";
import { localDayWindow } from "@/lib/data/analytics";
import type { StudySessionRow } from "@/lib/data/types";

/**
 * Study analytics.
 *
 * ---------------------------------------------------------------------------
 * DURATION COMES FROM THE DATABASE, NOT FROM A RECOMPUTATION
 * ---------------------------------------------------------------------------
 * `study_sessions.duration_seconds` is a STORED GENERATED column: Postgres
 * derives it from `started_at`/`ended_at` and no client can set it. It is
 * therefore the authoritative duration, and this module sums it rather than
 * re-deriving `ended_at - started_at` in JavaScript.
 *
 * That distinction is not cosmetic. Recomputing would silently disagree with the
 * database the moment the two diverged - for example after a retroactive edit -
 * and the analytics would then report time the database does not believe was
 * spent.
 *
 * ---------------------------------------------------------------------------
 * WHY SESSIONS ARE NOT COUNTED EQUALLY
 * ---------------------------------------------------------------------------
 * Every total below is seconds, never a count of rows. A 2-hour session
 * contributes 7,200 and a 20-minute session 1,200, so "most studied subject"
 * means the one that consumed the most time rather than the one logged most
 * often.
 *
 * ---------------------------------------------------------------------------
 * INCOMPLETE SESSIONS
 * ---------------------------------------------------------------------------
 * A running session has `ended_at = NULL`, which makes `duration_seconds` NULL.
 * Those rows are excluded from every total: a session in progress has spent no
 * time yet, and counting a null as zero would drag the averages down with an
 * artefact. The count of open sessions is reported separately so a user can see
 * one is running.
 *
 * Nothing is double-counted because each row contributes at most once, and the
 * query selects the session id alongside the duration so that is checkable.
 */

export type SubjectTime = {
  subjectId: string | null;
  /** The subject's name, or a clear placeholder for an unclassified session. */
  label: string;
  totalSeconds: number;
  sessionCount: number;
};

export type StudyAnalytics = {
  totalSeconds: number;
  todaySeconds: number;
  weekSeconds: number;
  monthSeconds: number;
  completedSessions: number;
  /** Sessions still running; excluded from every time total above. */
  openSessions: number;
  /** Mean duration of completed sessions, or 0 when there are none. */
  averageSessionSeconds: number;
  bySubject: SubjectTime[];
  /** The subject that consumed the most time, or null when there is none. */
  topSubject: SubjectTime | null;
  recentSessions: {
    id: string;
    subject: string;
    topic: string | null;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
  }[];
};

const SESSION_COLUMNS = "id, subject_id, topic, started_at, ended_at, duration_seconds";

const secondsBetween = (from: Date, days: number): number => {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate() - (days - 1));
  return Math.floor((from.getTime() - start.getTime()) / 1000);
};

/** The subset of a session row the analytics actually read. */
type AnalyticsSession = Pick<
  StudySessionRow,
  "id" | "subject_id" | "topic" | "started_at" | "ended_at" | "duration_seconds"
>;

/**
 * Reads the workspace's completed sessions plus the currently running ones.
 *
 * Two parallel reads, and only the columns analytics needs - no notes, no
 * workspace metadata.
 */
const loadSessions = async (
  workspaceId: string,
  userId: string,
  since: string
): Promise<{ finished: AnalyticsSession[]; open: AnalyticsSession[] }> => {
  const [finished, open] = await Promise.all([
    db()
      .from("study_sessions")
      .select(SESSION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .not("ended_at", "is", null)
      .gte("started_at", since),
    db()
      .from("study_sessions")
      .select(SESSION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("ended_at", null)
  ]);

  if (finished.error) throw toDataError(finished.error, "Could not read your study history.");
  if (open.error) throw toDataError(open.error, "Could not read your study sessions.");

  // `duration_seconds` is generated and non-null exactly when `ended_at` is set,
  // but the filter is applied again here so a null can never be summed into a
  // total even if the two ever disagreed.
  return {
    finished: (finished.data ?? []).filter(
      (row): row is AnalyticsSession => typeof row.duration_seconds === "number"
    ),
    open: open.data ?? []
  };
};

const UNCLASSIFIED = "Unclassified";

/**
 * The full study readout for one user.
 *
 * Scoped to `user_id` as well as the workspace: study time is personal, and two
 * people sharing a workspace must not have their hours pooled together.
 */
export const getStudyAnalytics = async (
  workspaceId: string,
  userId: string,
  now: Date = new Date()
): Promise<StudyAnalytics> => {
  const today = localDayWindow(now);
  const since = new Date(new Date(today.start).getTime() - 30 * 86_400_000).toISOString();

  const [{ finished, open }, subjectResult] = await Promise.all([
    loadSessions(workspaceId, userId, since),
    db().from("study_subjects").select("id, name").eq("workspace_id", workspaceId)
  ]);
  if (subjectResult.error) {
    throw toDataError(subjectResult.error, "Could not read your study subjects.");
  }
  const subjectNames = new Map(
    (subjectResult.data ?? []).map((row) => [row.id as string, row.name as string])
  );

  const todayEnd = new Date(today.end).getTime();
  const todayStart = new Date(today.start).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let totalSeconds = 0;
  let todaySeconds = 0;
  let weekSeconds = 0;
  let monthSeconds = 0;

  const perSubject = new Map<string, SubjectTime>();
  const recentSessions: StudyAnalytics["recentSessions"] = [];

  for (const row of finished) {
    // Belt and braces: a negative duration cannot exist (the table has a CHECK),
    // but clamping means a future schema change could not make a total shrink.
    const seconds = Math.max(0, row.duration_seconds ?? 0);
    const startedMs = new Date(row.started_at).getTime();

    totalSeconds += seconds;
    if (startedMs >= todayStart && startedMs < todayEnd) todaySeconds += seconds;
    if (startedMs >= now.getTime() - secondsBetween(now, 7) * 1000) weekSeconds += seconds;
    if (startedMs >= monthStart) monthSeconds += seconds;

    // An unclassified session is grouped under an explicit label rather than
    // dropped, so the time is still accounted for instead of vanishing from the
    // donut and making the parts not add up to the whole.
    const subjectId = (row.subject_id as string | null) ?? null;
    const label = subjectId ? subjectNames.get(subjectId) ?? UNCLASSIFIED : UNCLASSIFIED;
    const key = subjectId ?? "__unclassified__";
    const bucket = perSubject.get(key) ?? {
      subjectId,
      label,
      totalSeconds: 0,
      sessionCount: 0
    };
    bucket.totalSeconds += seconds;
    bucket.sessionCount += 1;
    perSubject.set(key, bucket);

    recentSessions.push({
      id: row.id,
      subject: label,
      topic: (row.topic as string | null) ?? null,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: seconds
    });
  }

  const bySubject = [...perSubject.values()].sort(
    (a, b) => b.totalSeconds - a.totalSeconds || a.label.localeCompare(b.label)
  );

  return {
    totalSeconds,
    todaySeconds,
    weekSeconds,
    monthSeconds,
    completedSessions: finished.length,
    openSessions: open.length,
    // Rounded so a 1.5-hour average does not display as 5397.3 seconds.
    averageSessionSeconds:
      finished.length === 0 ? 0 : Math.round(totalSeconds / finished.length),
    bySubject,
    topSubject: bySubject.length > 0 ? bySubject[0] : null,
    recentSessions: recentSessions
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 20)
  };
};

/** One day's total, for the daily trend chart. */
export type StudyTrendPoint = {
  /** `YYYY-MM-DD` in local time. */
  day: string;
  totalSeconds: number;
};

/**
 * Study seconds per local day, oldest first.
 *
 * Bucketed client-side from the session rows because the day boundary is local -
 * the `study_daily_totals` view groups in UTC, which would place a late-evening
 * session on the wrong day for most of the world. Days with no study are emitted
 * as zeroes so the axis stays continuous.
 */
export const getStudyTrend = async (
  workspaceId: string,
  userId: string,
  days: number,
  now: Date = new Date()
): Promise<StudyTrendPoint[]> => {
  const buckets: StudyTrendPoint[] = [];
  const pad = (n: number) => `${n}`.padStart(2, "0");

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    const window = localDayWindow(day);
    buckets.push({
      day: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
      totalSeconds: 0
    });
  }

  const first = buckets[0]?.day;
  if (!first) return buckets;
  const sinceIso = new Date(`${first}T00:00:00`).toISOString();

  const { data, error } = await db()
    .from("study_sessions")
    .select("started_at, duration_seconds")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .gte("started_at", sinceIso);

  if (error) throw toDataError(error, "Could not read your study history.");

  const byDay = new Map(buckets.map((point) => [point.day, point]));
  for (const row of data ?? []) {
    if (typeof row.duration_seconds !== "number") continue;
    const started = new Date(row.started_at);
    if (Number.isNaN(started.getTime())) continue;
    const key = `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}`;
    const bucket = byDay.get(key);
    if (bucket) bucket.totalSeconds += Math.max(0, row.duration_seconds);
  }
  return buckets;
};