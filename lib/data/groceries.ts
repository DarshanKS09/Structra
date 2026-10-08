import { db } from "@/lib/data/client";
import { toDataError, validationError } from "@/lib/data/errors";
import type {
  GroceryItemRow,
  GroceryListRow,
  GroceryUnit,
  GroceryItemUpdate,
  GroceryListUpdate
} from "@/lib/data/types";

/**
 * Grocery lists and items.
 *
 * A grocery list is the tenancy boundary for its items - `grocery_items` has no
 * `workspace_id`, and RLS resolves access through the parent list. That is why
 * every function here takes a list id rather than a workspace id.
 *
 * Quantities are not summed across differing units in the database: 2 kg and
 * 500 g are different measures, and merging them silently would be a
 * correctness bug rather than a convenience.
 */

/** Default list created on first use so grocery mode is never empty of lists. */
export const DEFAULT_LIST_NAME = "My Groceries";

export const listGroceryLists = async (workspaceId: string): Promise<GroceryListRow[]> => {
  const { data, error } = await db()
    .from("grocery_lists")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw toDataError(error, "Could not load your grocery lists.");
  return data ?? [];
};

export const createGroceryList = async (
  workspaceId: string,
  name: string
): Promise<GroceryListRow> => {
  if (!name.trim()) throw validationError("A grocery list needs a name.");

  const { data, error } = await db()
    .from("grocery_lists")
    .insert({ workspace_id: workspaceId, name: name.trim() })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not create the grocery list.");
  return data;
};

/** Returns the user's default list, creating it if this is the first visit. */
/**
 * The ACTIVE grocery list, creating one on first use.
 *
 * Only lists with `completed_at IS NULL` qualify. A finished trip is history, not
 * the current shop, so reusing one would put last week's purchases back on the
 * shelf. The `name` match is a tiebreak within the active set only.
 */
export const ensureDefaultGroceryList = async (workspaceId: string): Promise<GroceryListRow> => {
  const active = await listActiveGroceryLists(workspaceId);
  const existing = active.find((list) => list.name === DEFAULT_LIST_NAME) ?? active[0];
  if (existing) return existing;
  return createGroceryList(workspaceId, DEFAULT_LIST_NAME);
};

/**
 * Lists still being shopped, oldest first so the "current" one is stable.
 *
 * `.is("completed_at", null)` is what distinguishes an active list from a
 * preserved previous trip.
 */
export const listActiveGroceryLists = async (workspaceId: string): Promise<GroceryListRow[]> => {
  const { data, error } = await db()
    .from("grocery_lists")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("completed_at", null)
    .order("created_at", { ascending: true });
  if (error) throw toDataError(error, "Could not load your grocery lists.");
  return data ?? [];
};

/**
 * Completed trips, newest first - the history view.
 *
 * The limit matters: PostgREST caps rows per request, so without it a long
 * history would silently hide the most recent entries - exactly the wrong end to
 * truncate.
 */
export const listGroceryHistory = async (
  workspaceId: string,
  limit = 50
): Promise<GroceryListRow[]> => {
  const { data, error } = await db()
    .from("grocery_lists")
    .select("*")
    .eq("workspace_id", workspaceId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) throw toDataError(error, "Could not load your grocery history.");
  return data ?? [];
};

/**
 * Finishes the current trip, preserving it as history.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOES NOT DELETE ANYTHING
 * ---------------------------------------------------------------------------
 * The previous `clearCompletedGroceryItems` deleted every purchased row, which
 * destroyed the shopping record every time a list was finished - there was no way
 * back to "what did I buy last week".
 *
 * Marking the list complete preserves the list and its items with quantities and
 * `completed` flags intact, and records when the trip happened. Nothing is lost,
 * so history survives refresh, logout/login and being revisited months later.
 *
 * A fresh active list is created so the user is never left with nowhere to add
 * the next shop.
 */
export const completeGroceryList = async (
  workspaceId: string,
  listId: string
): Promise<{ completedList: GroceryListRow; activeList: GroceryListRow }> => {
  const { data, error } = await db()
    .from("grocery_lists")
    .update({ completed_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", listId)
    .is("completed_at", null) // never re-complete a historical trip
    .select("*")
    .single();

  if (error) throw toDataError(error, "Could not finish the grocery list.");

  const activeList = await ensureDefaultGroceryList(workspaceId);
  return { completedList: data, activeList };
};

/**
 * Copies a historical trip's outstanding items into the current list.
 *
 * Explicitly opt-in. Old items are never pushed back automatically, because doing
 * so would silently resurrect a shop the user already finished.
 *
 * Only items that were still unpurchased are copied - those are the ones worth
 * re-adding - and names already on the active list are skipped, so running this
 * twice cannot double the list.
 */
export const copyGroceryListItems = async (
  fromListId: string,
  toListId: string
): Promise<number> => {
  if (fromListId === toListId) {
    throw validationError("That list is already the current one.");
  }

  const [{ data: source, error: sourceError }, { data: existing, error: existingError }] =
    await Promise.all([
      db().from("grocery_items").select("*").eq("grocery_list_id", fromListId),
      db().from("grocery_items").select("name").eq("grocery_list_id", toListId)
    ]);
  if (sourceError) throw toDataError(sourceError, "Could not read that list.");
  if (existingError) throw toDataError(existingError, "Could not read the current list.");

  const alreadyThere = new Set((existing ?? []).map((row) => row.name.trim().toLowerCase()));
  const toInsert = (source ?? [])
    .filter((row) => !row.completed)
    .filter((row) => !alreadyThere.has(row.name.trim().toLowerCase()))
    .map((row) => ({
      grocery_list_id: toListId,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      completed: false,
      notes: row.notes
    }));

  if (toInsert.length === 0) return 0;

  const { error } = await db().from("grocery_items").insert(toInsert);
  if (error) throw toDataError(error, "Could not copy those items.");
  return toInsert.length;
};

/** A history entry plus its item counts, without loading every item row. */
export type GroceryHistoryEntry = {
  list: GroceryListRow;
  itemCount: number;
  /** Items bought on that trip. */
  completedCount: number;
};

/**
 * Previous trips with their counts, newest first.
 *
 * The counts come from ONE read of the items across all those lists, not one
 * query per list - which would be an N+1 on exactly the screen a user opens to
 * browse their history.
 */
export const getGroceryHistory = async (
  workspaceId: string,
  limit = 50
): Promise<GroceryHistoryEntry[]> => {
  const lists = await listGroceryHistory(workspaceId, limit);
  if (lists.length === 0) return [];

  const { data: items, error } = await db()
    .from("grocery_items")
    .select("grocery_list_id, completed")
    .in(
      "grocery_list_id",
      lists.map((list) => list.id)
    );

  if (error) throw toDataError(error, "Could not load your grocery history.");

  const counts = new Map<string, { itemCount: number; completedCount: number }>();
  for (const row of items ?? []) {
    const bucket = counts.get(row.grocery_list_id) ?? { itemCount: 0, completedCount: 0 };
    bucket.itemCount += 1;
    if (row.completed) bucket.completedCount += 1;
    counts.set(row.grocery_list_id, bucket);
  }

  return lists.map((list) => ({
    list,
    itemCount: counts.get(list.id)?.itemCount ?? 0,
    completedCount: counts.get(list.id)?.completedCount ?? 0
  }));
};

export const renameGroceryList = async (
  workspaceId: string,
  listId: string,
  patch: GroceryListUpdate
): Promise<GroceryListRow> => {
  const { data, error } = await db()
    .from("grocery_lists")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", listId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not rename the grocery list.");
  return data;
};

export const deleteGroceryList = async (workspaceId: string, listId: string): Promise<void> => {
  const { error } = await db()
    .from("grocery_lists")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", listId);
  if (error) throw toDataError(error, "Could not delete the grocery list.");
};

export type ListGroceryItemsOptions = {
  search?: string;
  /** "all" | "active" (not yet purchased) | "completed" (purchased). */
  filter?: "all" | "active" | "completed";
};

const escapeLike = (value: string) => value.replace(/[%_]/g, (c) => `\\${c}`);

export const listGroceryItems = async (
  listId: string,
  options: ListGroceryItemsOptions = {}
): Promise<GroceryItemRow[]> => {
  const { search = "", filter = "all" } = options;

  let query = db().from("grocery_items").select("*").eq("grocery_list_id", listId);

  if (filter === "active") query = query.eq("completed", false);
  else if (filter === "completed") query = query.eq("completed", true);

  const trimmed = search.trim();
  if (trimmed) {
    query = query.or(`name.ilike.%${escapeLike(trimmed)}%,notes.ilike.%${escapeLike(trimmed)}%`);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw toDataError(error, "Could not load grocery items.");
  return data ?? [];
};

export const createGroceryItem = async (
  listId: string,
  input: { name: string; quantity?: number | null; unit?: GroceryUnit | null; notes?: string | null }
): Promise<GroceryItemRow> => {
  if (!input.name?.trim()) throw validationError("A grocery item needs a name.");
  if (input.quantity !== undefined && input.quantity !== null && input.quantity < 0) {
    throw validationError("Quantity cannot be negative.");
  }

  const { data, error } = await db()
    .from("grocery_items")
    .insert({
      grocery_list_id: listId,
      name: input.name.trim(),
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      notes: input.notes ?? null
    })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not add the grocery item.");
  return data;
};

/** Marks an item bought or not bought. */
export const setGroceryItemCompleted = async (
  listId: string,
  itemId: string,
  completed: boolean
): Promise<GroceryItemRow> => {
  const { data, error } = await db()
    .from("grocery_items")
    .update({ completed })
    .eq("grocery_list_id", listId)
    .eq("id", itemId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not update the grocery item.");
  return data;
};

export const updateGroceryItem = async (
  listId: string,
  itemId: string,
  patch: GroceryItemUpdate
): Promise<GroceryItemRow> => {
  const { data, error } = await db()
    .from("grocery_items")
    .update(patch)
    .eq("grocery_list_id", listId)
    .eq("id", itemId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not update the grocery item.");
  return data;
};

/** Removes purchased items - the "clear bought" action the flat list lacked. */
export const clearCompletedGroceryItems = async (listId: string): Promise<void> => {
  const { error } = await db()
    .from("grocery_items")
    .delete()
    .eq("grocery_list_id", listId)
    .eq("completed", true);
  if (error) throw toDataError(error, "Could not clear purchased items.");
};

export const deleteGroceryItem = async (listId: string, itemId: string): Promise<void> => {
  const { error } = await db()
    .from("grocery_items")
    .delete()
    .eq("grocery_list_id", listId)
    .eq("id", itemId);
  if (error) throw toDataError(error, "Could not delete the grocery item.");
};

/** Groups items by normalised name so "Milk" appears once with a total count. */
export const groupGroceryItemsByName = (items: GroceryItemRow[]) => {
  const groups = new Map<string, GroceryItemRow[]>();
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
};