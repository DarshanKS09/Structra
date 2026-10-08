"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sumStudySeconds = exports.listStudyDailyTotals = exports.deleteStudySession = exports.updateStudySession = exports.stopStudySession = exports.startStudySession = exports.getRunningSession = exports.listStudySessions = exports.deleteStudySubject = exports.findOrCreateStudySubject = exports.createStudySubject = exports.listStudySubjects = void 0;
const client_1 = require("./stub-client.js");
const errors_1 = require("./stub-errors.js");
const escapeLike = (value) => value.replace(/[%_]/g, (c) => `\\${c}`);
const listStudySubjects = async (workspaceId) => {
    const { data, error } = await (0, client_1.db)()
        .from("study_subjects")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name", { ascending: true });
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load study subjects.");
    return data ?? [];
};
exports.listStudySubjects = listStudySubjects;
const createStudySubject = async (workspaceId, input) => {
    if (!input.name?.trim())
        throw (0, errors_1.validationError)("A subject needs a name.");
    const { data, error } = await (0, client_1.db)()
        .from("study_subjects")
        .insert({ workspace_id: workspaceId, name: input.name.trim(), description: input.description ?? null })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not create the subject.");
    return data;
};
exports.createStudySubject = createStudySubject;
/** Free-text subjects entered on a session are promoted to real subjects. */
const findOrCreateStudySubject = async (workspaceId, name) => {
    const trimmed = name.trim();
    if (!trimmed)
        return null;
    const { data: existing } = await (0, client_1.db)()
        .from("study_subjects")
        .select("*")
        .eq("workspace_id", workspaceId)
        .ilike("name", trimmed)
        .maybeSingle();
    if (existing)
        return existing;
    return (0, exports.createStudySubject)(workspaceId, { name: trimmed });
};
exports.findOrCreateStudySubject = findOrCreateStudySubject;
const deleteStudySubject = async (workspaceId, subjectId) => {
    const { error } = await (0, client_1.db)()
        .from("study_subjects")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", subjectId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the subject.");
};
exports.deleteStudySubject = deleteStudySubject;
const listStudySessions = async (workspaceId, userId, options = {}) => {
    const { search = "", runningOnly = false, completedOnly = false, limit = 100, since } = options;
    let query = (0, client_1.db)()
        .from("study_sessions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId);
    if (runningOnly)
        query = query.is("ended_at", null);
    if (completedOnly)
        query = query.not("ended_at", "is", null);
    const trimmed = search.trim();
    if (trimmed) {
        query = query.or(`topic.ilike.%${escapeLike(trimmed)}%,notes.ilike.%${escapeLike(trimmed)}%`);
    }
    if (since)
        query = query.gte("started_at", since);
    const { data, error } = await query.order("started_at", { ascending: false }).limit(limit);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load your study sessions.");
    return data ?? [];
};
exports.listStudySessions = listStudySessions;
/** The single running session for this user, if any. */
const getRunningSession = async (workspaceId, userId) => {
    const { data, error } = await (0, client_1.db)()
        .from("study_sessions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load the running session.");
    return data;
};
exports.getRunningSession = getRunningSession;
/**
 * Starts a session. `ended_at` is left null and `duration_seconds` is computed
 * by the database when the session is stopped.
 */
const startStudySession = async (workspaceId, userId, input) => {
    let subjectId = input.subjectId ?? null;
    if (!subjectId && input.subjectName) {
        const subject = await (0, exports.findOrCreateStudySubject)(workspaceId, input.subjectName);
        subjectId = subject?.id ?? null;
    }
    const { data, error } = await (0, client_1.db)()
        .from("study_sessions")
        .insert({
        workspace_id: workspaceId,
        user_id: userId,
        subject_id: subjectId,
        topic: input.topic?.trim() || null,
        started_at: input.startedAt ?? new Date().toISOString(),
        notes: input.notes ?? null
    })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not start the session.");
    return data;
};
exports.startStudySession = startStudySession;
/**
 * Stops a running session.
 *
 * Only `ended_at` is sent: `duration_seconds` is a generated column and the
 * database derives it, so the client cannot report a different number than the
 * timestamps imply.
 */
const stopStudySession = async (workspaceId, sessionId, endedAt = new Date().toISOString()) => {
    const { data, error } = await (0, client_1.db)()
        .from("study_sessions")
        .update({ ended_at: endedAt })
        .eq("workspace_id", workspaceId)
        .eq("id", sessionId)
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not stop the session.");
    return data;
};
exports.stopStudySession = stopStudySession;
const updateStudySession = async (workspaceId, sessionId, patch) => {
    const { data, error } = await (0, client_1.db)()
        .from("study_sessions")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", sessionId)
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update the session.");
    return data;
};
exports.updateStudySession = updateStudySession;
const deleteStudySession = async (workspaceId, sessionId) => {
    const { error } = await (0, client_1.db)()
        .from("study_sessions")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", sessionId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the session.");
};
exports.deleteStudySession = deleteStudySession;
/** Aggregates from the `study_daily_totals` view. */
const listStudyDailyTotals = async (workspaceId, userId, days = 30) => {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await (0, client_1.db)()
        .from("study_daily_totals")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .gte("day", since.slice(0, 10))
        .order("day", { ascending: false });
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load study totals.");
    return (data ?? []);
};
exports.listStudyDailyTotals = listStudyDailyTotals;
/** Total seconds across a window - the figure the dashboard shows. */
const sumStudySeconds = (sessions) => sessions.reduce((total, session) => total + (session.duration_seconds ?? 0), 0);
exports.sumStudySeconds = sumStudySeconds;
