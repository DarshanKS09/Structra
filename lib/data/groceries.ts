import { db } from "@/lib/data/client";
import { toDataError, validationError } from "@/lib/data/errors";
import type {
  GroceryItemInsert,
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

/**
 * Every unit the `grocery_unit` enum accepts, as a runtime set.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS WHEN THE TYPES ALREADY KNOW
 * ---------------------------------------------------------------------------
 * `Database["public"]["Enums"]["grocery_unit"]` is `"kg" | "g" | "pieces" |
 * "liters"` at COMPILE time, and `grocery_items.unit` is generated from it, so a
 * row read back through Supabase is already correctly typed. This set is
 * therefore not needed to satisfy the compiler - and it is not a substitute for
 * it either.
 *
 * It exists because `copyGroceryListItems` reads rows and re-inserts them through
 * a DIFFERENT call, and the type of that value has to be re-established at the
 * point of insertion. Previously the re-insert array was annotated with a
 * hand-written structural type (`unit: string | null`), which is a duplicate of
 * the schema and drifts the moment anyone edits it - that is precisely how the
 * production build broke, twice. Deriving the array from
 * `TablesInsert<"grocery_items">` removes the duplicate entirely.
 *
 * The set is the runtime half of the same guarantee, for the one case types
 * cannot cover: a value that reaches this module from OUTSIDE the generated
 * types (a hand-edited legacy payload, an old localStorage import) can be any
 * string at runtime. Postgres would reject it - the enum does - but only AFTER
 * the whole multi-row INSERT had been assembled and the user had waited for the
 * round trip. Filtering first means an unsupported unit is reported as such
 * instead of failing the copy as a whole.
 */
const SUPPORTED_UNITS: ReadonlySet<string> = new Set<GroceryUnit>([
  "kg",
  "g",
  "pieces",
  "liters"
]);

/**
 * Narrows an arbitrary value to a unit the database will accept, or `null`.
 *
 * Normalises case and surrounding whitespace, because "Kg" and " kg " are the
 * same unit and rejecting them would be pedantry rather than safety.
 *
 * Returns `null` for anything unrecognised. That is a deliberate, explicit
 * outcome rather than a silent pass-through: `grocery_items.unit` is an enum, so
 * writing an unsupported value would fail the ENTIRE batch insert and lose the
 * copy. Callers are expected to report the affected items.
 */
export const normaliseGroceryUnit = (value: unknown): GroceryUnit | null => {
  if (value === null || value === undefined) return null;
  const candidate = String(value).trim().toLowerCase();
  return SUPPORTED_UNITS.has(candidate) ? (candidate as GroceryUnit) : null;
};

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
let completedAtSupported: boolean | null = null;

const supportsCompletedAt = async (): Promise<boolean> => {
  if (completedAtSupported !== null) return completedAtSupported;
  const { error } = await db()
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
export const listActiveGroceryLists = async (workspaceId: string): Promise<GroceryListRow[]> => {
  const query = db()
    .from("grocery_lists")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  // Pre-migration there is only ever one list, so no filter is needed.
  if (await supportsCompletedAt()) query.is("completed_at", null);

  const { data, error } = await query;
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
  // Pre-migration nothing can have been archived, so report an empty history
  // rather than issuing a query that would fail.
  if (!(await supportsCompletedAt())) return [];

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
): Promise<{ completedList: GroceryListRow; activeList: GroceryListRow | null }> => {
  // Without the column there is nowhere to record the archive, so say so plainly
  // rather than falling back to deleting the items - which is the exact behaviour
  // this feature exists to remove.
  //
  // The message names the exact file and command, because this is a deployment
  // gap rather than a user mistake: the code is correct and the schema is behind.
  // Telling someone merely that "a migration is required" leaves them to guess.
  if (!(await supportsCompletedAt())) {
    throw validationError(
      "Grocery history is unavailable because grocery_lists.completed_at does not exist yet. " +
        "Apply supabase/migrations/20250101001300_reminders_and_grocery_history.sql " +
        "with `npx supabase db push`, then reload the page."
    );
  }

  // The archive is the operation that must not be lost, so it is a single
  // compare-and-set: the `.is("completed_at", null)` guard means a double submit,
  // or a retry after a dropped connection, matches zero rows and surfaces an
  // error rather than stamping the list twice. Duplicate history is therefore
  // impossible rather than merely unlikely.
  const { data, error } = await db()
    .from("grocery_lists")
    .update({ completed_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", listId)
    .is("completed_at", null) // never re-complete a historical trip
    .select("*")
    .single();

  if (error) throw toDataError(error, "Could not finish the grocery list.");

  // ---------------------------------------------------------------------------
  // WHY A FAILED SUCCESSOR LIST DOES NOT FAIL THE ARCHIVE
  // ---------------------------------------------------------------------------
  // By this point the trip is durably in history. If creating the next active
  // list then fails, reporting a hard error would be a lie about the database:
  // the user would retry a finish that has already happened.
  //
  // Returning `activeList: null` keeps the archive, reports success, and lets the
  // caller re-resolve the active list on its next read - `ensureDefaultGroceryList`
  // creates it on demand, so the user is never permanently stranded without one.
  const activeList = await ensureDefaultGroceryList(workspaceId).catch(() => null);
  return { completedList: data, activeList };
};

/**
 * Canonical form of an item name, used to decide whether two rows are "the same
 * thing".
 *
 * Case and surrounding whitespace are cosmetic ("  Milk " and "milk" are one
 * item), so they are collapsed. Interior whitespace is collapsed too, because
 * "Tomato   Soup" and "Tomato Soup" are obviously the same purchase and treating
 * them as different produces exactly the duplicate rows this function exists to
 * prevent.
 *
 * Deliberately NOT aggressive: no stemming, no singular/plural folding, no
 * synonym mapping. "tomatoes" and "tomato" stay distinct, because guessing that
 * they are the same would silently drop a real item from the user's list.
 */
const normaliseItemName = (name: string): string =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Are two quantities measured the same way?
 *
 * Two items are only interchangeable if their units agree, or if either side
 * simply has no unit recorded - an unspecified quantity and an explicit one are
 * not a conflict, because there is nothing to contradict.
 *
 * `kg` and `liters` are deliberately NOT compatible. Merging them would be
 * inventing arithmetic the user never asked for, which is the same reasoning
 * that keeps the schema from summing quantities across differing units.
 */
const unitsCompatible = (a: GroceryUnit | null, b: GroceryUnit | null): boolean =>
  a === null || b === null || a === b;

/** The result of copying one historical trip onto the active list. */
export type CopyGroceryResult = {
  /** Items inserted into the active list. */
  added: number;
  /** Historical items already represented on the active list. */
  alreadyPresent: number;
  /**
   * Historical items skipped because the active list has the same name in a
   * DIFFERENT unit - for example "Milk 2 liters" already on the list versus
   * "Milk 500 g" in the history.
   *
   * Reported rather than silently copied, because copying would put two rows
   * both reading "Milk" in front of the user, and silently skipping would hide
   * that an item was left behind.
   */
  unitConflicts: string[];
  /**
   * Historical items skipped because their stored unit is not one of the
   * supported enum values (`kg`, `g`, `pieces`, `liters`).
   *
   * Normally empty: the column is a Postgres enum, so an unsupported value
   * cannot exist in a row this module read. It is populated only by data that
   * reached the database by some other route, and it is reported rather than
   * passed through, because writing it would fail the entire batch insert.
   */
  unsupportedUnits: string[];
  /** The historical list that was read. */
  fromListId: string;
  /** The active list that was written. */
  toListId: string;
};

/** Serialises concurrent copies so a double click cannot interleave two reads. */
const copiesInFlight = new Set<string>();

/**
 * Copies a historical trip's items into the current list.
 *
 * ---------------------------------------------------------------------------
 * WHY THE READ IS INSIDE A LOCK
 * ---------------------------------------------------------------------------
 * Duplicate handling is "read what is there, then insert only what is missing".
 * Two of those running at once both read the pre-copy state, both decide the
 * same items are missing, and both insert - producing exactly the duplicates
 * this is meant to prevent. A repeated click and a client-side retry are the
 * same failure. The in-flight guard serialises them per source/target pair
 * inside this module; the caller disables its button as well, which is a
 * courtesy to the user rather than the correctness mechanism.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY ITEM IS COPIED, NOT ONLY THE UNBOUGHT ONES
 * ---------------------------------------------------------------------------
 * The whole point is to shop the list again, so every item is copied and every
 * copy starts unpurchased (`completed: false`). Copying only what was left
 * unbought would quietly mean something else - "restore my omissions" - and
 * would leave the user with a list that silently omits things they had bought.
 *
 * ---------------------------------------------------------------------------
 * THE SOURCE IS NEVER TOUCHED
 * ---------------------------------------------------------------------------
 * This function only ever INSERTs into `toListId`. There is no UPDATE or DELETE
 * anywhere in it, so the historical trip and its items cannot be modified,
 * re-ordered, or archived by reusing it.
 */
export const copyGroceryListItems = async (
  fromListId: string,
  toListId: string
): Promise<CopyGroceryResult> => {
  if (fromListId === toListId) {
    throw validationError("That list is already the current one.");
  }

  const lockKey = `${fromListId}->${toListId}`;
  if (copiesInFlight.has(lockKey)) {
    throw validationError("That list is already being copied. Try again in a moment.");
  }
  copiesInFlight.add(lockKey);

  try {
    // Both reads in parallel: the source to copy from and the target to compare
    // against. Both are scoped by the caller's own session, so RLS is what
    // prevents one user reading - let alone copying - another's history.
    const [{ data: source, error: sourceError }, { data: existing, error: existingError }] =
      await Promise.all([
        db().from("grocery_items").select("*").eq("grocery_list_id", fromListId),
        db().from("grocery_items").select("name, unit").eq("grocery_list_id", toListId)
      ]);
    if (sourceError) throw toDataError(sourceError, "Could not read that list.");
    if (existingError) throw toDataError(existingError, "Could not read the current list.");

    // Index the active list once, by normalised name. O(active) rather than
    // O(source x active), which matters for a long-running household's history.
    const activeByName = new Map<string, { unit: GroceryUnit | null }[]>();
    for (const row of existing ?? []) {
      const key = normaliseItemName(row.name);
      // Normalised on the way in for the same reason as the source rows: an
      // existing "Kg" and an incoming "kg" must compare equal, or a legacy
      // capitalisation would read as a unit conflict and skip a real item.
      const unit = normaliseGroceryUnit(row.unit);
      const bucket = activeByName.get(key);
      if (bucket) bucket.push({ unit });
      else activeByName.set(key, [{ unit }]);
    }

    /*
     * Typed from the GENERATED schema, not hand-written.
     *
     * The previous annotation spelled out `{ grocery_list_id: string; name:
     * string; quantity: number | null; unit: string | null; ... }`, which is a
     * second, hand-maintained copy of the `grocery_items` shape. It happened to
     * disagree with the real column type, and because a structural type is not
     * checked against the schema, the disagreement only surfaced at the `.insert`
     * call - far from the line that introduced it, and only on a full production
     * build. Deriving the shape means there is nothing left to drift: if the
     * column changes, this follows automatically.
     */
    const toInsert: GroceryItemInsert[] = [];
    const unitConflicts: string[] = [];
    /** Historical rows whose unit is not a supported value; see `normaliseGroceryUnit`. */
    const unsupportedUnits: string[] = [];
    let alreadyPresent = 0;

    for (const row of source ?? []) {
      const key = normaliseItemName(row.name);
      const matches = activeByName.get(key);
      /*
       * Resolved once per row and used for both the duplicate comparison and the
       * write, so the unit that decided compatibility is provably the unit that
       * gets stored. Normalising at the boundary means a legacy "Kg" and a
       * current "kg" compare equal instead of looking like a conflict.
       */
      const unit = normaliseGroceryUnit(row.unit);

      // An unrecognised unit cannot be written, and writing it would fail the
      // whole batch. Drop the item and say so, rather than losing the copy.
      if (unit === null && row.unit !== null && row.unit !== undefined) {
        unsupportedUnits.push(`${row.name} (unit "${String(row.unit)}")`);
        continue;
      }

      if (matches && matches.length > 0) {
        const compatible = matches.some((m) => unitsCompatible(m.unit, unit));
        if (compatible) {
          // Already on the active list. Left exactly as it is - its quantity and
          // its purchased state are the user's current intent and must not be
          // overwritten by a stale historical value.
          alreadyPresent += 1;
          continue;
        }
        // Same name, incompatible unit. Not copied, and not hidden either.
        unitConflicts.push(`${row.name}${row.quantity != null ? ` (${row.quantity}${unit ? ` ${unit}` : ""})` : ""}`);
        continue;
      }

      toInsert.push({
        grocery_list_id: toListId,
        name: row.name,
        quantity: row.quantity,
        unit,
        // Always starts unbought, so the copied list can actually be shopped.
        completed: false,
        notes: row.notes
      });
    }

    if (unsupportedUnits.length > 0) {
      // Surfaced rather than swallowed. This is data the user cannot recover by
      // retrying, so hiding it would be the worse failure of the two.
      reportUnsupportedUnits(unsupportedUnits);
    }

    if (toInsert.length === 0) {
      return { added: 0, alreadyPresent, unitConflicts, unsupportedUnits, fromListId, toListId };
    }

    // One multi-row INSERT, which is atomic: either the whole copy lands or none
    // of it does, so a failure cannot leave a half-copied list behind.
    const { error } = await db().from("grocery_items").insert(toInsert);
    if (error) throw toDataError(error, "Could not copy those items.");

    return {
      added: toInsert.length,
      alreadyPresent,
      unitConflicts,
      unsupportedUnits,
      fromListId,
      toListId
    };
  } finally {
    copiesInFlight.delete(lockKey);
  }
};

/**
 * Reports historical rows whose unit is not a supported enum value.
 *
 * Intentionally a console warning rather than a thrown error or a user-facing
 * banner. It cannot fail the copy - the affected items were already excluded
 * before the insert - and the alternative would be to abort a working copy over
 * one malformed legacy row. The console keeps the information available for
 * support and for anyone investigating old data, and `CopyGroceryResult` carries
 * the same list so a caller can surface it if it wants to.
 */
const reportUnsupportedUnits = (items: string[]): void => {
  const shown = items.slice(0, 5).join(", ");
  const more = items.length > 5 ? ` and ${items.length - 5} more` : "";
  // eslint-disable-next-line no-console
  console.warn(
    `[grocery history] skipped ${items.length} item(s) with an unsupported unit: ${shown}${more}`
  );
};

/** One-line summary of a copy, so the UI never has to reconstruct the counts. */
export const describeCopyResult = (result: CopyGroceryResult): string => {
  const parts: string[] = [];
  parts.push(
    result.added === 0
      ? "Nothing new to add"
      : `Added ${result.added} item${result.added === 1 ? "" : "s"} to your current list`
  );
  if (result.alreadyPresent > 0) {
    parts.push(`${result.alreadyPresent} already on it`);
  }
  if (result.unitConflicts.length > 0) {
    const shown = result.unitConflicts.slice(0, 3).join(", ");
    const more = result.unitConflicts.length > 3 ? ` and ${result.unitConflicts.length - 3} more` : "";
    parts.push(`skipped ${result.unitConflicts.length} in a different unit (${shown}${more})`);
  }
  if (result.unsupportedUnits.length > 0) {
    // Reported to the user, not just logged. An item that could not be copied is
    // something they need to know about, and saying nothing would imply the whole
    // list came across.
    const shown = result.unsupportedUnits.slice(0, 2).join(", ");
    const more = result.unsupportedUnits.length > 2 ? ` and ${result.unsupportedUnits.length - 2} more` : "";
    parts.push(
      `could not copy ${result.unsupportedUnits.length} item(s) with an unrecognised unit (${shown}${more})`
    );
  }
  return `${parts.join(", ")}.`;
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