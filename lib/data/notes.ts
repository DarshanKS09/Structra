import { db, safeArchiveTimestamp } from "@/lib/data/client";
import { toDataError, validationError } from "@/lib/data/errors";
import type { NoteInsert, NoteRow, NoteUpdate } from "@/lib/data/types";

/**
 * Notes, including the Meeting Notes mode.
 *
 * Notes are workspace-scoped but personally owned (`user_id`), so the list is
 * filtered to the author: a shared workspace's notes stay private to whoever
 * wrote them.
 */

export type ListNotesOptions = {
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
};

const escapeLike = (value: string) => value.replace(/[%_]/g, (c) => `\\${c}`);

export const listNotes = async (
  workspaceId: string,
  userId: string,
  options: ListNotesOptions = {}
): Promise<NoteRow[]> => {
  const { search = "", includeArchived = false, limit, offset } = options;

  let query = db()
    .from("notes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (!includeArchived) query = query.is("archived_at", null);

  const trimmed = search.trim();
  if (trimmed) {
    query = query.or(`title.ilike.%${escapeLike(trimmed)}%,content.ilike.%${escapeLike(trimmed)}%`);
  }

  query = query.order("created_at", { ascending: false });
  if (typeof limit === "number") query = query.limit(limit);
  if (typeof offset === "number") query = query.range(offset, offset + (limit ?? 50) - 1);

  const { data, error } = await query;
  if (error) throw toDataError(error, "Could not load your notes.");
  return data ?? [];
};

export const createNote = async (
  workspaceId: string,
  userId: string,
  input: { title: string; content?: string | null }
): Promise<NoteRow> => {
  if (!input.title?.trim()) throw validationError("A note needs a title.");

  const { data, error } = await db()
    .from("notes")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      title: input.title.trim(),
      content: input.content ?? null
    })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not create the note.");
  return data;
};

export const updateNote = async (
  workspaceId: string,
  noteId: string,
  patch: NoteUpdate
): Promise<NoteRow> => {
  if (patch.title != null && !patch.title.trim()) {
    throw validationError("A note needs a title.");
  }

  const { data, error } = await db()
    .from("notes")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", noteId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not update the note.");
  return data;
};

/**
 * Soft delete, so a note is recoverable.
 *
 * The timestamp is clamped against the row's own `created_at`: the schema
 * CHECKs `archived_at >= created_at`, and those two values come from different
 * clocks. See `safeArchiveTimestamp`.
 */
export const archiveNote = async (
  workspaceId: string,
  noteId: string,
  archived = true
): Promise<NoteRow> => {
  if (!archived) return updateNote(workspaceId, noteId, { archived_at: null });

  const at = await safeArchiveTimestamp(async () => {
    const { data } = await db()
      .from("notes")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .eq("id", noteId)
      .maybeSingle();
    return data?.created_at ?? null;
  });

  return updateNote(workspaceId, noteId, { archived_at: at });
};

export const deleteNote = async (workspaceId: string, noteId: string): Promise<void> => {
  const { error } = await db().from("notes").delete().eq("workspace_id", workspaceId).eq("id", noteId);
  if (error) throw toDataError(error, "Could not delete the note.");
};

export type { NoteInsert };