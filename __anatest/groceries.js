"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupGroceryItemsByName = exports.deleteGroceryItem = exports.clearCompletedGroceryItems = exports.updateGroceryItem = exports.setGroceryItemCompleted = exports.createGroceryItem = exports.listGroceryItems = exports.deleteGroceryList = exports.renameGroceryList = exports.getGroceryHistory = exports.copyGroceryListItems = exports.completeGroceryList = exports.listGroceryHistory = exports.listActiveGroceryLists = exports.ensureDefaultGroceryList = exports.createGroceryList = exports.listGroceryLists = exports.DEFAULT_LIST_NAME = void 0;
const client_1 = require("./stub-client.js");
const errors_1 = require("./stub-errors.js");
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
exports.DEFAULT_LIST_NAME = "My Groceries";
const listGroceryLists = async (workspaceId) => {
    const { data, error } = await (0, client_1.db)()
        .from("grocery_lists")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load your grocery lists.");
    return data ?? [];
};
exports.listGroceryLists = listGroceryLists;
const createGroceryList = async (workspaceId, name) => {
    if (!name.trim())
        throw (0, errors_1.validationError)("A grocery list needs a name.");
    const { data, error } = await (0, client_1.db)()
        .from("grocery_lists")
        .insert({ workspace_id: workspaceId, name: name.trim() })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not create the grocery list.");
    return data;
};
exports.createGroceryList = createGroceryList;
/** Returns the user's default list, creating it if this is the first visit. */
/**
 * The ACTIVE grocery list, creating one on first use.
 *
 * Only lists with `completed_at IS NULL` qualify. A finished trip is history, not
 * the current shop, so reusing one would put last week's purchases back on the
 * shelf. The `name` match is a tiebreak within the active set only.
 */
const ensureDefaultGroceryList = async (workspaceId) => {
    const active = await (0, exports.listActiveGroceryLists)(workspaceId);
    const existing = active.find((list) => list.name === exports.DEFAULT_LIST_NAME) ?? active[0];
    if (existing)
        return existing;
    return (0, exports.createGroceryList)(workspaceId, exports.DEFAULT_LIST_NAME);
};
exports.ensureDefaultGroceryList = ensureDefaultGroceryList;
/**
 * Whether `grocery_lists.completed_at` exists yet.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PROBE EXISTS
 * ---------------------------------------------------------------------------
 * The column arrives with migration
 * `20250101001300_reminders_and_grocery_history.sql`. Until that is applied,
 * filtering on it makes PostgREST reject the whole query with
 * `column grocery_lists.completed_at does not exist` - which would break the
 * grocery section outright.
 *
 * Breaking a working feature to ship a new one is the wrong trade, so the probe
 * detects the missing column once and the caller falls back to pre-migration
 * behaviour. Once the migration is applied the cached answer flips and history
 * starts separating automatically, with no code change and no second deploy.
 *
 * Cached for the lifetime of the tab: the schema cannot change under a running
 * client, so re-probing on every load would be waste.
 */
let completedAtSupported = null;
const supportsCompletedAt = async () => {
    if (completedAtSupported !== null)
        return completedAtSupported;
    const { error } = await (0, client_1.db)()
        .from("grocery_lists")
        .select("id, completed_at")
        .eq("workspace_id", "00000000-0000-0000-0000-000000000000")
        .limit(1);
    // A missing column is the only error that changes the answer. Anything else
    // (RLS, network) means the column exists and this probe merely failed.
    completedAtSupported = error
        ? !/completed_at.*does not exist|column .*completed_at/i.test(error.message)
        : true;
    return completedAtSupported;
};
/**
 * Lists still being shopped, oldest first so the "current" one is stable.
 *
 * `.is("completed_at", null)` is what distinguishes an active list from a
 * preserved previous trip.
 */
const listActiveGroceryLists = async (workspaceId) => {
    const query = (0, client_1.db)()
        .from("grocery_lists")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });
    // Pre-migration there is only ever one list, so no filter is needed.
    if (await supportsCompletedAt())
        query.is("completed_at", null);
    const { data, error } = await query;
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load your grocery lists.");
    return data ?? [];
};
exports.listActiveGroceryLists = listActiveGroceryLists;
/**
 * Completed trips, newest first - the history view.
 *
 * The limit matters: PostgREST caps rows per request, so without it a long
 * history would silently hide the most recent entries - exactly the wrong end to
 * truncate.
 */
const listGroceryHistory = async (workspaceId, limit = 50) => {
    // Pre-migration nothing can have been archived, so report an empty history
    // rather than issuing a query that would fail.
    if (!(await supportsCompletedAt()))
        return [];
    const { data, error } = await (0, client_1.db)()
        .from("grocery_lists")
        .select("*")
        .eq("workspace_id", workspaceId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(limit);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load your grocery history.");
    return data ?? [];
};
exports.listGroceryHistory = listGroceryHistory;
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
const completeGroceryList = async (workspaceId, listId) => {
    // Without the column there is nowhere to record the archive, so say so plainly
    // rather than falling back to deleting the items - which is the exact behaviour
    // this feature exists to remove.
    if (!(await supportsCompletedAt())) {
        throw (0, errors_1.validationError)("Grocery history is unavailable until its database migration is applied.");
    }
    const { data, error } = await (0, client_1.db)()
        .from("grocery_lists")
        .update({ completed_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("id", listId)
        .is("completed_at", null) // never re-complete a historical trip
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not finish the grocery list.");
    const activeList = await (0, exports.ensureDefaultGroceryList)(workspaceId);
    return { completedList: data, activeList };
};
exports.completeGroceryList = completeGroceryList;
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
const copyGroceryListItems = async (fromListId, toListId) => {
    if (fromListId === toListId) {
        throw (0, errors_1.validationError)("That list is already the current one.");
    }
    const [{ data: source, error: sourceError }, { data: existing, error: existingError }] = await Promise.all([
        (0, client_1.db)().from("grocery_items").select("*").eq("grocery_list_id", fromListId),
        (0, client_1.db)().from("grocery_items").select("name").eq("grocery_list_id", toListId)
    ]);
    if (sourceError)
        throw (0, errors_1.toDataError)(sourceError, "Could not read that list.");
    if (existingError)
        throw (0, errors_1.toDataError)(existingError, "Could not read the current list.");
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
    if (toInsert.length === 0)
        return 0;
    const { error } = await (0, client_1.db)().from("grocery_items").insert(toInsert);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not copy those items.");
    return toInsert.length;
};
exports.copyGroceryListItems = copyGroceryListItems;
/**
 * Previous trips with their counts, newest first.
 *
 * The counts come from ONE read of the items across all those lists, not one
 * query per list - which would be an N+1 on exactly the screen a user opens to
 * browse their history.
 */
const getGroceryHistory = async (workspaceId, limit = 50) => {
    const lists = await (0, exports.listGroceryHistory)(workspaceId, limit);
    if (lists.length === 0)
        return [];
    const { data: items, error } = await (0, client_1.db)()
        .from("grocery_items")
        .select("grocery_list_id, completed")
        .in("grocery_list_id", lists.map((list) => list.id));
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load your grocery history.");
    const counts = new Map();
    for (const row of items ?? []) {
        const bucket = counts.get(row.grocery_list_id) ?? { itemCount: 0, completedCount: 0 };
        bucket.itemCount += 1;
        if (row.completed)
            bucket.completedCount += 1;
        counts.set(row.grocery_list_id, bucket);
    }
    return lists.map((list) => ({
        list,
        itemCount: counts.get(list.id)?.itemCount ?? 0,
        completedCount: counts.get(list.id)?.completedCount ?? 0
    }));
};
exports.getGroceryHistory = getGroceryHistory;
const renameGroceryList = async (workspaceId, listId, patch) => {
    const { data, error } = await (0, client_1.db)()
        .from("grocery_lists")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", listId)
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not rename the grocery list.");
    return data;
};
exports.renameGroceryList = renameGroceryList;
const deleteGroceryList = async (workspaceId, listId) => {
    const { error } = await (0, client_1.db)()
        .from("grocery_lists")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", listId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the grocery list.");
};
exports.deleteGroceryList = deleteGroceryList;
const escapeLike = (value) => value.replace(/[%_]/g, (c) => `\\${c}`);
const listGroceryItems = async (listId, options = {}) => {
    const { search = "", filter = "all" } = options;
    let query = (0, client_1.db)().from("grocery_items").select("*").eq("grocery_list_id", listId);
    if (filter === "active")
        query = query.eq("completed", false);
    else if (filter === "completed")
        query = query.eq("completed", true);
    const trimmed = search.trim();
    if (trimmed) {
        query = query.or(`name.ilike.%${escapeLike(trimmed)}%,notes.ilike.%${escapeLike(trimmed)}%`);
    }
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load grocery items.");
    return data ?? [];
};
exports.listGroceryItems = listGroceryItems;
const createGroceryItem = async (listId, input) => {
    if (!input.name?.trim())
        throw (0, errors_1.validationError)("A grocery item needs a name.");
    if (input.quantity !== undefined && input.quantity !== null && input.quantity < 0) {
        throw (0, errors_1.validationError)("Quantity cannot be negative.");
    }
    const { data, error } = await (0, client_1.db)()
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
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not add the grocery item.");
    return data;
};
exports.createGroceryItem = createGroceryItem;
/** Marks an item bought or not bought. */
const setGroceryItemCompleted = async (listId, itemId, completed) => {
    const { data, error } = await (0, client_1.db)()
        .from("grocery_items")
        .update({ completed })
        .eq("grocery_list_id", listId)
        .eq("id", itemId)
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update the grocery item.");
    return data;
};
exports.setGroceryItemCompleted = setGroceryItemCompleted;
const updateGroceryItem = async (listId, itemId, patch) => {
    const { data, error } = await (0, client_1.db)()
        .from("grocery_items")
        .update(patch)
        .eq("grocery_list_id", listId)
        .eq("id", itemId)
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update the grocery item.");
    return data;
};
exports.updateGroceryItem = updateGroceryItem;
/** Removes purchased items - the "clear bought" action the flat list lacked. */
const clearCompletedGroceryItems = async (listId) => {
    const { error } = await (0, client_1.db)()
        .from("grocery_items")
        .delete()
        .eq("grocery_list_id", listId)
        .eq("completed", true);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not clear purchased items.");
};
exports.clearCompletedGroceryItems = clearCompletedGroceryItems;
const deleteGroceryItem = async (listId, itemId) => {
    const { error } = await (0, client_1.db)()
        .from("grocery_items")
        .delete()
        .eq("grocery_list_id", listId)
        .eq("id", itemId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the grocery item.");
};
exports.deleteGroceryItem = deleteGroceryItem;
/** Groups items by normalised name so "Milk" appears once with a total count. */
const groupGroceryItemsByName = (items) => {
    const groups = new Map();
    for (const item of items) {
        const key = item.name.trim().toLowerCase();
        const bucket = groups.get(key);
        if (bucket)
            bucket.push(item);
        else
            groups.set(key, [item]);
    }
    return groups;
};
exports.groupGroceryItemsByName = groupGroceryItemsByName;
