"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withDataField = exports.readDataField = exports.deleteRecord = exports.archiveRecord = exports.updateRecordData = exports.updateRecord = exports.createRecord = exports.getRecord = exports.listRecords = exports.deleteRecordCategory = exports.createRecordCategory = exports.listRecordCategories = exports.deleteRecordType = exports.ensureRecordType = exports.createRecordType = exports.getRecordType = exports.listRecordTypes = exports.BUILT_IN_RECORD_TYPES = void 0;
const client_1 = require("./stub-client.js");
const errors_1 = require("./stub-errors.js");
/** Predefined types backing the built-in modes that have no dedicated table. */
exports.BUILT_IN_RECORD_TYPES = {
    fitness: "Fitness",
    shopping: "Shopping"
};
const listRecordTypes = async (workspaceId) => {
    const { data, error } = await (0, client_1.db)()
        .from("record_types")
        .select("*")
        .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
        .order("name", { ascending: true });
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load record types.");
    return data ?? [];
};
exports.listRecordTypes = listRecordTypes;
const getRecordType = async (workspaceId, recordTypeId) => {
    const { data, error } = await (0, client_1.db)()
        .from("record_types")
        .select("*")
        .eq("id", recordTypeId)
        .maybeSingle();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load the record type.");
    return data;
};
exports.getRecordType = getRecordType;
const createRecordType = async (workspaceId, userId, input) => {
    if (!input.name?.trim())
        throw (0, errors_1.validationError)("A record type needs a name.");
    // `record_types` has a CHECK requiring `configuration` to be a JSON
    // *object*. The old code sent the bare field array, which is a JSON array and
    // was rejected by the database - so every `ensureRecordType` call made
    // without explicit configuration failed, taking the Fitness and Shopping
    // modes down with it. Wrap the definitions and default to an empty object.
    const configuration = input.configuration && input.configuration.length > 0
        ? { fields: input.configuration }
        : {};
    const { data, error } = await (0, client_1.db)()
        .from("record_types")
        .insert({
        workspace_id: workspaceId,
        created_by: userId,
        name: input.name.trim(),
        description: input.description ?? null,
        configuration: configuration
    })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not create the record type.");
    return data;
};
exports.createRecordType = createRecordType;
/**
 * Resolves a record type by name, creating it for this workspace if absent.
 *
 * Idempotent and race-safe: the unique index on (workspace_id, name) means a
 * concurrent call fails with a constraint error, which is caught and retried as
 * a read rather than surfacing an error the user cannot act on.
 */
const ensureRecordType = async (workspaceId, userId, name, configuration) => {
    const trimmed = name.trim();
    const { data: existing } = await (0, client_1.db)()
        .from("record_types")
        .select("*")
        .eq("workspace_id", workspaceId)
        .ilike("name", trimmed)
        .maybeSingle();
    if (existing)
        return existing;
    try {
        return await (0, exports.createRecordType)(workspaceId, userId, { name: trimmed, configuration });
    }
    catch (error) {
        const isConflict = typeof error === "object" && error !== null && error.code === "23505";
        if (!isConflict)
            throw error;
        const { data: raced } = await (0, client_1.db)()
            .from("record_types")
            .select("*")
            .eq("workspace_id", workspaceId)
            .ilike("name", trimmed)
            .maybeSingle();
        if (raced)
            return raced;
        throw error;
    }
};
exports.ensureRecordType = ensureRecordType;
const deleteRecordType = async (workspaceId, recordTypeId) => {
    const { error } = await (0, client_1.db)()
        .from("record_types")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", recordTypeId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the record type.");
};
exports.deleteRecordType = deleteRecordType;
// ---------------------------------------------------------------------------
// Record categories
// ---------------------------------------------------------------------------
const listRecordCategories = async (workspaceId) => {
    const { data, error } = await (0, client_1.db)()
        .from("record_categories")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name", { ascending: true });
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load record categories.");
    return data ?? [];
};
exports.listRecordCategories = listRecordCategories;
const createRecordCategory = async (workspaceId, name) => {
    if (!name.trim())
        throw (0, errors_1.validationError)("A category needs a name.");
    const { data, error } = await (0, client_1.db)()
        .from("record_categories")
        .insert({ workspace_id: workspaceId, name: name.trim() })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not create the category.");
    return data;
};
exports.createRecordCategory = createRecordCategory;
const deleteRecordCategory = async (workspaceId, categoryId) => {
    const { error } = await (0, client_1.db)()
        .from("record_categories")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", categoryId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the category.");
};
exports.deleteRecordCategory = deleteRecordCategory;
const escapeLike = (value) => value.replace(/[%_]/g, (c) => `\\${c}`);
const listRecords = async (workspaceId, options = {}) => {
    const { recordTypeId, categoryId, search = "", includeArchived = false, limit, offset } = options;
    let query = (0, client_1.db)().from("records").select("*").eq("workspace_id", workspaceId);
    if (recordTypeId)
        query = query.eq("record_type_id", recordTypeId);
    if (categoryId)
        query = query.eq("category_id", categoryId);
    if (!includeArchived)
        query = query.is("archived_at", null);
    const trimmed = search.trim();
    if (trimmed) {
        query = query.or(`title.ilike.%${escapeLike(trimmed)}%,description.ilike.%${escapeLike(trimmed)}%`);
    }
    query = query.order("created_at", { ascending: false });
    if (typeof limit === "number")
        query = query.limit(limit);
    if (typeof offset === "number")
        query = query.range(offset, offset + (limit ?? 50) - 1);
    const { data, error } = await query;
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load records.");
    return data ?? [];
};
exports.listRecords = listRecords;
const getRecord = async (workspaceId, recordId) => {
    const { data, error } = await (0, client_1.db)()
        .from("records")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", recordId)
        .maybeSingle();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load the record.");
    return data;
};
exports.getRecord = getRecord;
const createRecord = async (workspaceId, createdBy, input) => {
    if (!input.title?.trim())
        throw (0, errors_1.validationError)("A record needs a title.");
    if (!input.recordTypeId)
        throw (0, errors_1.validationError)("A record needs a type.");
    const { data, error } = await (0, client_1.db)()
        .from("records")
        .insert({
        workspace_id: workspaceId,
        created_by: createdBy,
        record_type_id: input.recordTypeId,
        category_id: input.categoryId ?? null,
        title: input.title.trim(),
        description: input.description ?? null,
        data: (input.data ?? {})
    })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not create the record.");
    return data;
};
exports.createRecord = createRecord;
const updateRecord = async (workspaceId, recordId, patch) => {
    if (patch.title != null && !patch.title.trim()) {
        throw (0, errors_1.validationError)("A record needs a title.");
    }
    const { data, error } = await (0, client_1.db)()
        .from("records")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", recordId)
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update the record.");
    return data;
};
exports.updateRecord = updateRecord;
/**
 * Updates only the `data` JSONB column.
 *
 * `RecordUpdate["data"]` is typed as `Json`, so the cast to `Record<string,
 * unknown>` here is what keeps callers from being able to store an array or a
 * scalar - which the schema's CHECK constraint would reject anyway.
 */
const updateRecordData = async (workspaceId, recordId, data) => (0, exports.updateRecord)(workspaceId, recordId, { data: data });
exports.updateRecordData = updateRecordData;
const archiveRecord = async (workspaceId, recordId, archived = true) => (0, exports.updateRecord)(workspaceId, recordId, { archived_at: archived ? new Date().toISOString() : null });
exports.archiveRecord = archiveRecord;
const deleteRecord = async (workspaceId, recordId) => {
    const { error } = await (0, client_1.db)().from("records").delete().eq("workspace_id", workspaceId).eq("id", recordId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the record.");
};
exports.deleteRecord = deleteRecord;
/** Safely reads a field out of the `data` JSONB column. */
const readDataField = (row, key, fallback) => {
    const data = row.data;
    if (typeof data !== "object" || data === null || Array.isArray(data))
        return fallback;
    const value = data[key];
    return value === undefined || value === null ? fallback : value;
};
exports.readDataField = readDataField;
/** Safely writes a field into the `data` JSONB column, preserving the rest. */
const withDataField = (row, key, value) => {
    const current = typeof row.data === "object" && row.data !== null && !Array.isArray(row.data)
        ? { ...row.data }
        : {};
    current[key] = value;
    return current;
};
exports.withDataField = withDataField;
