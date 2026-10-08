"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStudyTrend = exports.getStudyAnalytics = void 0;
const client_1 = require("./stub-client.js");
const errors_1 = require("./stub-errors.js");
const analytics_1 = require("./analytics.js");
const SESSION_COLUMNS = "id, subject_id, topic, started_at, ended_at, duration_seconds";
const secondsBetween = (from, days) => {
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate() - (days - 1));
    return Math.floor((from.getTime() - start.getTime()) / 1000);
};
/**
 * Reads the workspace's completed sessions plus the currently running ones.
 *
 * Two parallel reads, and only the columns analytics needs - no notes, no
 * workspace metadata.
 */
const loadSessions = async (workspaceId, userId, since) => {
    const [finished, open] = await Promise.all([
        (0, client_1.db)()
            .from("study_sessions")
            .select(SESSION_COLUMNS)
            .eq("workspace_id", workspaceId)
            .eq("user_id", userId)
            .not("ended_at", "is", null)
            .gte("started_at", since),
        (0, client_1.db)()
            .from("study_sessions")
            .select(SESSION_COLUMNS)
            .eq("workspace_id", workspaceId)
            .eq("user_id", userId)
            .is("ended_at", null)
    ]);
    if (finished.error)
        throw (0, errors_1.toDataError)(finished.error, "Could not read your study history.");
    if (open.error)
        throw (0, errors_1.toDataError)(open.error, "Could not read your study sessions.");
    // `duration_seconds` is generated and non-null exactly when `ended_at` is set,
    // but the filter is applied again here so a null can never be summed into a
    // total even if the two ever disagreed.
    return {
        finished: (finished.data ?? []).filter((row) => typeof row.duration_seconds === "number"),
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
const getStudyAnalytics = async (workspaceId, userId, now = new Date()) => {
    const today = (0, analytics_1.localDayWindow)(now);
    const since = new Date(new Date(today.start).getTime() - 30 * 86400000).toISOString();
    const [{ finished, open }, subjectResult] = await Promise.all([
        loadSessions(workspaceId, userId, since),
        (0, client_1.db)().from("study_subjects").select("id, name").eq("workspace_id", workspaceId)
    ]);
    if (subjectResult.error) {
        throw (0, errors_1.toDataError)(subjectResult.error, "Could not read your study subjects.");
    }
    const subjectNames = new Map((subjectResult.data ?? []).map((row) => [row.id, row.name]));
    const todayEnd = new Date(today.end).getTime();
    const todayStart = new Date(today.start).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let totalSeconds = 0;
    let todaySeconds = 0;
    let weekSeconds = 0;
    let monthSeconds = 0;
    const perSubject = new Map();
    const recentSessions = [];
    for (const row of finished) {
        // Belt and braces: a negative duration cannot exist (the table has a CHECK),
        // but clamping means a future schema change could not make a total shrink.
        const seconds = Math.max(0, row.duration_seconds ?? 0);
        const startedMs = new Date(row.started_at).getTime();
        totalSeconds += seconds;
        if (startedMs >= todayStart && startedMs < todayEnd)
            todaySeconds += seconds;
        if (startedMs >= now.getTime() - secondsBetween(now, 7) * 1000)
            weekSeconds += seconds;
        if (startedMs >= monthStart)
            monthSeconds += seconds;
        // An unclassified session is grouped under an explicit label rather than
        // dropped, so the time is still accounted for instead of vanishing from the
        // donut and making the parts not add up to the whole.
        const subjectId = row.subject_id ?? null;
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
            topic: row.topic ?? null,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            durationSeconds: seconds
        });
    }
    const bySubject = [...perSubject.values()].sort((a, b) => b.totalSeconds - a.totalSeconds || a.label.localeCompare(b.label));
    return {
        totalSeconds,
        todaySeconds,
        weekSeconds,
        monthSeconds,
        completedSessions: finished.length,
        openSessions: open.length,
        // Rounded so a 1.5-hour average does not display as 5397.3 seconds.
        averageSessionSeconds: finished.length === 0 ? 0 : Math.round(totalSeconds / finished.length),
        bySubject,
        topSubject: bySubject.length > 0 ? bySubject[0] : null,
        recentSessions: recentSessions
            .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
            .slice(0, 20)
    };
};
exports.getStudyAnalytics = getStudyAnalytics;
/**
 * Study seconds per local day, oldest first.
 *
 * Bucketed client-side from the session rows because the day boundary is local -
 * the `study_daily_totals` view groups in UTC, which would place a late-evening
 * session on the wrong day for most of the world. Days with no study are emitted
 * as zeroes so the axis stays continuous.
 */
const getStudyTrend = async (workspaceId, userId, days, now = new Date()) => {
    const buckets = [];
    const pad = (n) => `${n}`.padStart(2, "0");
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const day = new Date(now);
        day.setDate(day.getDate() - offset);
        const window = (0, analytics_1.localDayWindow)(day);
        buckets.push({
            day: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
            totalSeconds: 0
        });
    }
    const first = buckets[0]?.day;
    if (!first)
        return buckets;
    const sinceIso = new Date(`${first}T00:00:00`).toISOString();
    const { data, error } = await (0, client_1.db)()
        .from("study_sessions")
        .select("started_at, duration_seconds")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .not("ended_at", "is", null)
        .gte("started_at", sinceIso);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not read your study history.");
    const byDay = new Map(buckets.map((point) => [point.day, point]));
    for (const row of data ?? []) {
        if (typeof row.duration_seconds !== "number")
            continue;
        const started = new Date(row.started_at);
        if (Number.isNaN(started.getTime()))
            continue;
        const key = `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}`;
        const bucket = byDay.get(key);
        if (bucket)
            bucket.totalSeconds += Math.max(0, row.duration_seconds);
    }
    return buckets;
};
exports.getStudyTrend = getStudyTrend;
