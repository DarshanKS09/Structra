import { db } from "@/lib/data/client";
import { toDataError, validationError } from "@/lib/data/errors";
import type { Json } from "@/lib/supabase/types";
import type {
  RecordCategoryRow,
  RecordInsert,
  RecordRow,
  RecordTypeRow,
  RecordUpdate
} from "@/lib/data/types";

/**
 * The general record system.
 *
 * Ownership (`workspace_id`, `created_by`), relationships (`record_type_id`,
 * `category_id`) and searchable fields (`title`) stay relational in PostgreSQL.
 * The `data` column holds ONLY the custom fields that vary by record type,
 * which is what lets a user track something new without a migration.
 *
 * Two of Structra's existing modes - Fitness and Shopping - are served here
 * rather than by dedicated tables. Both are small attribute bags
 * (sets/reps/duration, price/priority/purchased) that fit the record model, and
 * the schema deliberately provides this path so new tracking types do not each
 * require a table.
 */

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

/** Field definitions a type needs so the UI can render and validate a form. */
export type RecordFieldDefinition = {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "date";
  required?: boolean;
  options?: string[];
};

/** Predefined types backing the built-in modes that have no dedicated table. */
export const BUILT_IN_RECORD_TYPES = {
  fitness: "Fitness",
  shopping: "Shopping"
} as const;

export const listRecordTypes = async (workspaceId: string): Promise<RecordTypeRow[]> => {
  const { data, error } = await db()
    .from("record_types")
    .select("*")
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .order("name", { ascending: true });
  if (error) throw toDataError(error, "Could not load record types.");
  return data ?? [];
};

export const getRecordType = async (
  workspaceId: string,
  recordTypeId: string
): Promise<RecordTypeRow | null> => {
  const { data, error } = await db()
    .from("record_types")
    .select("*")
    .eq("id", recordTypeId)
    .maybeSingle();
  if (error) throw toDataError(error, "Could not load the record type.");
  return data;
};

export const createRecordType = async (
  workspaceId: string,
  userId: string,
  input: { name: string; description?: string | null; configuration?: RecordFieldDefinition[] }
): Promise<RecordTypeRow> => {
  if (!input.name?.trim()) throw validationError("A record type needs a name.");

  // `record_types` has a CHECK requiring `configuration` to be a JSON
  // *object*. The old code sent the bare field array, which is a JSON array and
  // was rejected by the database - so every `ensureRecordType` call made
  // without explicit configuration failed, taking the Fitness and Shopping
  // modes down with it. Wrap the definitions and default to an empty object.
  const configuration =
    input.configuration && input.configuration.length > 0
      ? { fields: input.configuration }
      : {};

  const { data, error } = await db()
    .from("record_types")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      name: input.name.trim(),
      description: input.description ?? null,
      configuration: configuration as Json
    })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not create the record type.");
  return data;
};

/**
 * Resolves a record type by name, creating it for this workspace if absent.
 *
 * Idempotent and race-safe: the unique index on (workspace_id, name) means a
 * concurrent call fails with a constraint error, which is caught and retried as
 * a read rather than surfacing an error the user cannot act on.
 */
export const ensureRecordType = async (
  workspaceId: string,
  userId: string,
  name: string,
  configuration?: RecordFieldDefinition[]
): Promise<RecordTypeRow> => {
  const trimmed = name.trim();

  const { data: existing } = await db()
    .from("record_types")
    .select("*")
    .eq("workspace_id", workspaceId)
    .ilike("name", trimmed)
    .maybeSingle();
  if (existing) return existing;

  try {
    return await createRecordType(workspaceId, userId, { name: trimmed, configuration });
  } catch (error) {
    const isConflict =
      typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
    if (!isConflict) throw error;

    const { data: raced } = await db()
      .from("record_types")
      .select("*")
      .eq("workspace_id", workspaceId)
      .ilike("name", trimmed)
      .maybeSingle();
    if (raced) return raced;
    throw error;
  }
};

export const deleteRecordType = async (workspaceId: string, recordTypeId: string): Promise<void> => {
  const { error } = await db()
    .from("record_types")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", recordTypeId);
  if (error) throw toDataError(error, "Could not delete the record type.");
};

// ---------------------------------------------------------------------------
// Record categories
// ---------------------------------------------------------------------------

export const listRecordCategories = async (workspaceId: string): Promise<RecordCategoryRow[]> => {
  const { data, error } = await db()
    .from("record_categories")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (error) throw toDataError(error, "Could not load record categories.");
  return data ?? [];
};

export const createRecordCategory = async (
  workspaceId: string,
  name: string
): Promise<RecordCategoryRow> => {
  if (!name.trim()) throw validationError("A category needs a name.");

  const { data, error } = await db()
    .from("record_categories")
    .insert({ workspace_id: workspaceId, name: name.trim() })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not create the category.");
  return data;
};

export const deleteRecordCategory = async (workspaceId: string, categoryId: string): Promise<void> => {
  const { error } = await db()
    .from("record_categories")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", categoryId);
  if (error) throw toDataError(error, "Could not delete the category.");
};

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type ListRecordsOptions = {
  recordTypeId?: string;
  categoryId?: string;
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
};

const escapeLike = (value: string) => value.replace(/[%_]/g, (c) => `\\${c}`);

export const listRecords = async (
  workspaceId: string,
  options: ListRecordsOptions = {}
): Promise<RecordRow[]> => {
  const { recordTypeId, categoryId, search = "", includeArchived = false, limit, offset } = options;

  let query = db().from("records").select("*").eq("workspace_id", workspaceId);

  if (recordTypeId) query = query.eq("record_type_id", recordTypeId);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (!includeArchived) query = query.is("archived_at", null);

  const trimmed = search.trim();
  if (trimmed) {
    query = query.or(
      `title.ilike.%${escapeLike(trimmed)}%,description.ilike.%${escapeLike(trimmed)}%`
    );
  }

  query = query.order("created_at", { ascending: false });
  if (typeof limit === "number") query = query.limit(limit);
  if (typeof offset === "number") query = query.range(offset, offset + (limit ?? 50) - 1);

  const { data, error } = await query;
  if (error) throw toDataError(error, "Could not load records.");
  return data ?? [];
};

export const getRecord = async (workspaceId: string, recordId: string): Promise<RecordRow | null> => {
  const { data, error } = await db()
    .from("records")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw toDataError(error, "Could not load the record.");
  return data;
};

export const createRecord = async (
  workspaceId: string,
  createdBy: string,
  input: {
    recordTypeId: string;
    categoryId?: string | null;
    title: string;
    description?: string | null;
    data?: Record<string, unknown>;
  }
): Promise<RecordRow> => {
  if (!input.title?.trim()) throw validationError("A record needs a title.");
  if (!input.recordTypeId) throw validationError("A record needs a type.");

  const { data, error } = await db()
    .from("records")
    .insert({
      workspace_id: workspaceId,
      created_by: createdBy,
      record_type_id: input.recordTypeId,
      category_id: input.categoryId ?? null,
      title: input.title.trim(),
      description: input.description ?? null,
      data: (input.data ?? {}) as Json
    })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not create the record.");
  return data;
};

export const updateRecord = async (
  workspaceId: string,
  recordId: string,
  patch: RecordUpdate
): Promise<RecordRow> => {
  if (patch.title != null && !patch.title.trim()) {
    throw validationError("A record needs a title.");
  }

  const { data, error } = await db()
    .from("records")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", recordId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not update the record.");
  return data;
};

/**
 * Updates only the `data` JSONB column.
 *
 * `RecordUpdate["data"]` is typed as `Json`, so the cast to `Record<string,
 * unknown>` here is what keeps callers from being able to store an array or a
 * scalar - which the schema's CHECK constraint would reject anyway.
 */
export const updateRecordData = async (
  workspaceId: string,
  recordId: string,
  data: Record<string, unknown>
): Promise<RecordRow> => updateRecord(workspaceId, recordId, { data: data as Json });

export const archiveRecord = async (
  workspaceId: string,
  recordId: string,
  archived = true
): Promise<RecordRow> =>
  updateRecord(workspaceId, recordId, { archived_at: archived ? new Date().toISOString() : null });

export const deleteRecord = async (workspaceId: string, recordId: string): Promise<void> => {
  const { error } = await db().from("records").delete().eq("workspace_id", workspaceId).eq("id", recordId);
  if (error) throw toDataError(error, "Could not delete the record.");
};

/** Safely reads a field out of the `data` JSONB column. */
export const readDataField = <T>(row: RecordRow, key: string, fallback: T): T => {
  const data = row.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return fallback;
  const value = (data as Record<string, unknown>)[key];
  return value === undefined || value === null ? fallback : (value as T);
};

/** Safely writes a field into the `data` JSONB column, preserving the rest. */
export const withDataField = <T extends Record<string, unknown>>(row: RecordRow, key: string, value: T[keyof T]): Record<string, unknown> => {
  const current = typeof row.data === "object" && row.data !== null && !Array.isArray(row.data)
    ? { ...(row.data as Record<string, unknown>) }
    : {};
  current[key] = value;
  return current;
};

export type { RecordInsert };