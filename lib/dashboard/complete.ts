import { setTaskCompleted } from "@/lib/data/tasks";
import { setGroceryItemCompleted, ensureDefaultGroceryList } from "@/lib/data/groceries";
import { setHabitCompleted, todayKey } from "@/lib/data/habits";
import { updateRecordData, ensureRecordType, BUILT_IN_RECORD_TYPES } from "@/lib/data/records";
import { archiveNote } from "@/lib/data/notes";
import { DataError } from "@/lib/data/errors";
import type { ListMode } from "@/types/taskTypes";

/**
 * Completes one item from the Dashboard.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The Dashboard is not a section, so it cannot use `useModeItems`' toggle: that
 * hook is bound to whichever single mode is on screen, while a Dashboard row can
 * belong to any of them.
 *
 * This is a thin adapter rather than a second implementation. Every write goes
 * through the SAME exported data-layer function that the section screen uses, so
 * there is still exactly one definition of how each mode is completed. Only the
 * dispatch - "which table backs this mode" - lives here.
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 * ---------------------------------------------------------------------------
 * `workspaceId` and `userId` come from the authenticated session and are the
 * values RLS evaluates against. Nothing here accepts a caller-supplied owner, so
 * a write can only ever land in the caller's own workspace.
 */
export type CompleteResult = { ok: true } | { ok: false; error: DataError };

export const completeItem = async (input: {
  mode: ListMode;
  itemId: string;
  workspaceId: string;
  userId: string;
  done: boolean;
}): Promise<CompleteResult> => {
  const { mode, itemId, workspaceId, userId, done } = input;

  try {
    switch (mode) {
      case "task":
        await setTaskCompleted(workspaceId, itemId, done);
        return { ok: true };

      case "grocery": {
        // The default list is created on demand, so the Dashboard works for a
        // user who has never opened the Grocery section.
        const list = await ensureDefaultGroceryList(workspaceId);
        await setGroceryItemCompleted(list.id, itemId, done);
        return { ok: true };
      }

      case "habit":
        // The streak is derived server-side, so the Dashboard re-reads after the
        // write rather than guessing the new value.
        await setHabitCompleted(workspaceId, userId, itemId, todayKey(), done);
        return { ok: true };

      case "fitness": {
        const type = await ensureRecordType(workspaceId, userId, BUILT_IN_RECORD_TYPES.fitness);
        await updateRecordData(workspaceId, itemId, { completed: done });
        void type;
        return { ok: true };
      }

      case "shopping": {
        await ensureRecordType(workspaceId, userId, BUILT_IN_RECORD_TYPES.shopping);
        await updateRecordData(workspaceId, itemId, { purchased: done });
        return { ok: true };
      }

      case "meeting":
        // Notes are archived rather than completed.
        await archiveNote(workspaceId, itemId, done);
        return { ok: true };

      case "study":
        // A study session is not "done" by ticking it; it is started and stopped
        // in the Study Planner, so the Dashboard deliberately does not offer it.
        throw new DataError("VALIDATION", "Start or stop sessions in the Study Planner.");

      default:
        throw new DataError("VALIDATION", "That item cannot be completed here.");
    }
  } catch (caught) {
    return { ok: false, error: caught instanceof DataError ? caught : new DataError("DATABASE", "Could not update that item.") };
  }
};