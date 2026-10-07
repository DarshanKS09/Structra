"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  clearLegacyItems,
  inspectLegacyData,
  migrateLegacyData,
  discardLegacyBackup,
  LEGACY_STORAGE_KEY,
  type LegacySnapshot,
  type MigrationProgress
} from "@/lib/data/local-migration";
import { modeLabels } from "@/types/taskTypes";
import type { ListMode } from "@/types/taskTypes";

/**
 * Controlled one-time import of pre-Supabase localStorage data.
 *
 * Deliberately opt-in: nothing is imported automatically. The banner appears,
 * shows exactly how many items are waiting in each mode, and the user chooses.
 *
 * The user's original payload is copied to a backup key before any insert, so a
 * failed import never costs data. The banner only clears itself after a
 * successful import, and even then the backup is retained until explicitly
 * discarded.
 */
export function LocalDataImport() {
  const { workspace, user } = useAuth();
  const [snapshot, setSnapshot] = useState<LegacySnapshot | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(inspectLegacyData());
  }, []);

  if (!snapshot || dismissed || !workspace || !user) return null;
  if (!snapshot.exists || snapshot.totalItems === 0 || snapshot.alreadyMigrated) return null;

  const onImport = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await migrateLegacyData(workspace.id, user.id);

      if (!result.ok) {
        // The legacy payload is untouched, so this can be retried safely.
        setError(result.error?.message ?? "The import failed. Your local data is unchanged.");
        return;
      }

      setProgress(result.progress);
      // Only remove the items from the active payload once they are safely in
      // the database. Preferences are preserved.
      clearLegacyItems();
      setSnapshot((previous) => (previous ? { ...previous, alreadyMigrated: true } : previous));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The import failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-white/15 bg-surface p-4 backdrop-blur-xl md:mx-8 light:border-slate-300 light:bg-white/80">
      <h2 className="text-sm font-semibold">Import your existing lists?</h2>
      <p className="mt-1 text-xs text-slate-300 light:text-slate-600">
        This device has {snapshot.totalItems} item{snapshot.totalItems === 1 ? "" : "s"} saved from
        before Structra used the cloud. They are still on this device and have not been changed.
      </p>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400 light:text-slate-500">
        {Object.entries(snapshot.countsByMode).map(([mode, count]) => (
          <li key={mode}>
            {modeLabels[mode as ListMode] ?? mode}: {count}
          </li>
        ))}
      </ul>

      {snapshot.corrupt ? (
        <p className="mt-2 text-xs text-amber-300 light:text-amber-700">
          Some saved data could not be read and will be skipped. A backup has not been changed.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-rose-300 light:text-rose-700">
          {error}
        </p>
      ) : null}

      {progress ? (
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-emerald-300 light:text-emerald-700">
            Imported {progress.imported} item{progress.imported === 1 ? "" : "s"}.
          </p>
          {progress.failed > 0 ? (
            <div className="text-amber-300 light:text-amber-700">
              <p>{progress.failed} could not be imported:</p>
              <ul className="ml-3 list-disc">
                {progress.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-slate-400 light:text-slate-500">
            A copy of the original data is still saved on this device under{" "}
            <code className="text-[10px]">{LEGACY_STORAGE_KEY}</code>.
          </p>
          <button
            type="button"
            onClick={() => {
              discardLegacyBackup();
              setDismissed(true);
            }}
            className="text-[11px] underline underline-offset-2"
          >
            Remove the local backup
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void onImport()}
            disabled={running}
            className="themed-accent-solid h-9 rounded-xl px-3 text-xs font-semibold disabled:opacity-60"
          >
            {running ? "Importing..." : "Import now"}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="h-9 rounded-xl border border-white/20 px-3 text-xs light:border-slate-300"
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}