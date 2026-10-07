import { db } from "@/lib/data/client";
import { toDataError, validationError } from "@/lib/data/errors";
import type {
  StudySessionRow,
  StudySubjectInsert,
  StudySubjectRow,
  StudySessionUpdate
} from "@/lib/data/types";

/**
 * Study subjects and study sessions.
 *
 * Individual sessions are stored rather than a rolled-up daily total, so daily,
 * weekly and monthly analytics can be computed in SQL at any time. The
 * `study_daily_totals` view provides the aggregation without duplicating state.
 */

export type ListStudySessionsOptions = {
  search?: string;
  /** Only sessions that are still running. */
  runningOnly?: boolean;
  /** Only sessions that have finished. */
  completedOnly?: boolean;
  limit?: number;
  since?: string;
};

const escapeLike = (value: string) => value.replace(/[%_]/g, (c) => `\\${c}`);

export const listStudySubjects = async (workspaceId: string): Promise<StudySubjectRow[]> => {
  const { data, error } = await db()
    .from("study_subjects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (error) throw toDataError(error, "Could not load study subjects.");
  return data ?? [];
};

export const createStudySubject = async (
  workspaceId: string,
  input: { name: string; description?: string | null }
): Promise<StudySubjectRow> => {
  if (!input.name?.trim()) throw validationError("A subject needs a name.");

  const { data, error } = await db()
    .from("study_subjects")
    .insert({ workspace_id: workspaceId, name: input.name.trim(), description: input.description ?? null })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not create the subject.");
  return data;
};

/** Free-text subjects entered on a session are promoted to real subjects. */
export const findOrCreateStudySubject = async (
  workspaceId: string,
  name: string
): Promise<StudySubjectRow | null> => {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const { data: existing } = await db()
    .from("study_subjects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .ilike("name", trimmed)
    .maybeSingle();
  if (existing) return existing;

  return createStudySubject(workspaceId, { name: trimmed });
};

export const deleteStudySubject = async (workspaceId: string, subjectId: string): Promise<void> => {
  const { error } = await db()
    .from("study_subjects")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", subjectId);
  if (error) throw toDataError(error, "Could not delete the subject.");
};

export const listStudySessions = async (
  workspaceId: string,
  userId: string,
  options: ListStudySessionsOptions = {}
): Promise<StudySessionRow[]> => {
  const { search = "", runningOnly = false, completedOnly = false, limit = 100, since } = options;

  let query = db()
    .from("study_sessions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (runningOnly) query = query.is("ended_at", null);
  if (completedOnly) query = query.not("ended_at", "is", null);

  const trimmed = search.trim();
  if (trimmed) {
    query = query.or(
      `topic.ilike.%${escapeLike(trimmed)}%,notes.ilike.%${escapeLike(trimmed)}%`
    );
  }
  if (since) query = query.gte("started_at", since);

  const { data, error } = await query.order("started_at", { ascending: false }).limit(limit);
  if (error) throw toDataError(error, "Could not load your study sessions.");
  return data ?? [];
};

/** The single running session for this user, if any. */
export const getRunningSession = async (
  workspaceId: string,
  userId: string
): Promise<StudySessionRow | null> => {
  const { data, error } = await db()
    .from("study_sessions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toDataError(error, "Could not load the running session.");
  return data;
};

/**
 * Starts a session. `ended_at` is left null and `duration_seconds` is computed
 * by the database when the session is stopped.
 */
export const startStudySession = async (
  workspaceId: string,
  userId: string,
  input: { subjectId?: string | null; subjectName?: string | null; topic?: string | null; startedAt?: string; notes?: string | null }
): Promise<StudySessionRow> => {
  let subjectId = input.subjectId ?? null;
  if (!subjectId && input.subjectName) {
    const subject = await findOrCreateStudySubject(workspaceId, input.subjectName);
    subjectId = subject?.id ?? null;
  }

  const { data, error } = await db()
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
  if (error) throw toDataError(error, "Could not start the session.");
  return data;
};

/**
 * Stops a running session.
 *
 * Only `ended_at` is sent: `duration_seconds` is a generated column and the
 * database derives it, so the client cannot report a different number than the
 * timestamps imply.
 */
export const stopStudySession = async (
  workspaceId: string,
  sessionId: string,
  endedAt: string = new Date().toISOString()
): Promise<StudySessionRow> => {
  const { data, error } = await db()
    .from("study_sessions")
    .update({ ended_at: endedAt })
    .eq("workspace_id", workspaceId)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not stop the session.");
  return data;
};

export const updateStudySession = async (
  workspaceId: string,
  sessionId: string,
  patch: StudySessionUpdate
): Promise<StudySessionRow> => {
  const { data, error } = await db()
    .from("study_sessions")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not update the session.");
  return data;
};

export const deleteStudySession = async (workspaceId: string, sessionId: string): Promise<void> => {
  const { error } = await db()
    .from("study_sessions")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", sessionId);
  if (error) throw toDataError(error, "Could not delete the session.");
};

export type StudyDailyTotal = {
  workspace_id: string;
  user_id: string;
  subject_id: string | null;
  day: string;
  session_count: number;
  total_seconds: number;
};

/** Aggregates from the `study_daily_totals` view. */
export const listStudyDailyTotals = async (
  workspaceId: string,
  userId: string,
  days = 30
): Promise<StudyDailyTotal[]> => {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data, error } = await db()
    .from("study_daily_totals")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .gte("day", since.slice(0, 10))
    .order("day", { ascending: false });
  if (error) throw toDataError(error, "Could not load study totals.");
  return (data ?? []) as unknown as StudyDailyTotal[];
};

/** Total seconds across a window - the figure the dashboard shows. */
export const sumStudySeconds = (sessions: StudySessionRow[]): number =>
  sessions.reduce((total, session) => total + (session.duration_seconds ?? 0), 0);

export type { StudySubjectInsert };