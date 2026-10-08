"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteNote = exports.archiveNote = exports.updateNote = exports.createNote = exports.listNotes = void 0;
const client_1 = require("./stub-client.js");
const errors_1 = require("./stub-errors.js");
const escapeLike = (value) => value.replace(/[%_]/g, (c) => `\\${c}`);
const listNotes = async (workspaceId, userId, options = {}) => {
    const { search = "", includeArchived = false, limit, offset } = options;
    let query = (0, client_1.db)()
        .from("notes")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId);
    if (!includeArchived)
        query = query.is("archived_at", null);
    const trimmed = search.trim();
    if (trimmed) {
        query = query.or(`title.ilike.%${escapeLike(trimmed)}%,content.ilike.%${escapeLike(trimmed)}%`);
    }
    query = query.order("created_at", { ascending: false });
    if (typeof limit === "number")
        query = query.limit(limit);
    if (typeof offset === "number")
        query = query.range(offset, offset + (limit ?? 50) - 1);
    const { data, error } = await query;
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load your notes.");
    return data ?? [];
};
exports.listNotes = listNotes;
const createNote = async (workspaceId, userId, input) => {
    if (!input.title?.trim())
        throw (0, errors_1.validationError)("A note needs a title.");
    const { data, error } = await (0, client_1.db)()
        .from("notes")
        .insert({
        workspace_id: workspaceId,
        user_id: userId,
        title: input.title.trim(),
        content: input.content ?? null
    })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not create the note.");
    return data;
};
exports.createNote = createNote;
const updateNote = async (workspaceId, noteId, patch) => {
    if (patch.title != null && !patch.title.trim()) {
        throw (0, errors_1.validationError)("A note needs a title.");
    }
    const { data, error } = await (0, client_1.db)()
        .from("notes")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", noteId)
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update the note.");
    return data;
};
exports.updateNote = updateNote;
/**
 * Soft delete, so a note is recoverable.
 *
 * The timestamp is clamped against the row's own `created_at`: the schema
 * CHECKs `archived_at >= created_at`, and those two values come from different
 * clocks. See `safeArchiveTimestamp`.
 */
const archiveNote = async (workspaceId, noteId, archived = true) => {
    if (!archived)
        return (0, exports.updateNote)(workspaceId, noteId, { archived_at: null });
    const at = await (0, client_1.safeArchiveTimestamp)(async () => {
        const { data } = await (0, client_1.db)()
            .from("notes")
            .select("created_at")
            .eq("workspace_id", workspaceId)
            .eq("id", noteId)
            .maybeSingle();
        return data?.created_at ?? null;
    });
    return (0, exports.updateNote)(workspaceId, noteId, { archived_at: at });
};
exports.archiveNote = archiveNote;
const deleteNote = async (workspaceId, noteId) => {
    const { error } = await (0, client_1.db)().from("notes").delete().eq("workspace_id", workspaceId).eq("id", noteId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the note.");
};
exports.deleteNote = deleteNote;
