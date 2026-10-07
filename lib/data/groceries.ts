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
export const ensureDefaultGroceryList = async (workspaceId: string): Promise<GroceryListRow> => {
  const lists = await listGroceryLists(workspaceId);
  const existing = lists.find((list) => list.name === DEFAULT_LIST_NAME) ?? lists[0];
  if (existing) return existing;
  return createGroceryList(workspaceId, DEFAULT_LIST_NAME);
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