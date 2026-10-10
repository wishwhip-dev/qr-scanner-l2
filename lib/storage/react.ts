"use client";

/**
 * GENERATED FILE — do not edit here.
 *
 * Vendored from the supervisor repository's `packages/app-storage` at version 0.3.0.
 * A later copy of the package replaces this file, so an edit made here is lost.
 * Anything this product needs that the shared code does not do belongs in lib/db.ts, lib/data/,
 * or a new module of your own.
 */
/**
 * The React side: live queries that survive server rendering, and the storage states a real
 * product has to draw.
 *
 * Two things go wrong when Dexie is used directly from a Next.js component, and both are handled
 * here rather than in every application:
 *
 * 1. The server renders the component too. Anything that touches IndexedDB at render time throws
 *    during the build, and the route fails to prerender.
 * 2. `useLiveQuery` returns `undefined` both while it is loading and when the query legitimately
 *    has no rows. An application that treats `undefined` as "empty" flashes its empty state on
 *    every load; one that treats it as "loading" shows a spinner forever on a genuinely empty
 *    database. `useStoredQuery` reports the difference.
 *
 * What is NOT here any more is a third state the application has to code around. Since 0.2.0 a
 * browser that refuses IndexedDB gets an in-memory database instead of an error, so there is one
 * data path, not two. `useStorageStatus` still reports which one it got, because the visitor
 * deserves to be told their work will not be kept — but that is a banner, not a branch.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { DatabaseHandle, StorageMode, TableMap } from "./database";
import {
  downloadExport,
  exportDatabase,
  exportFilename,
  importDatabase,
  parseExport,
  readExportFile,
  type ImportMode,
  type ImportResult,
} from "./transfer";

export { useLiveQuery };

/**
 * True only after hydration. The gate every hook below uses before touching the database.
 *
 * `useSyncExternalStore` with a subscription that never fires, rather than the familiar
 * `useState(false)` plus an effect that sets it to true. Same result, and it is the sanctioned
 * way to give the server and the client different snapshots of the same value — the effect
 * version is a lint error under `react-hooks/set-state-in-effect`, which the template's own CI
 * runs, so every application generated from it would start with a failing lint.
 */
const neverChanges = () => () => {};
export function useIsHydrated(): boolean {
  return useSyncExternalStore(neverChanges, () => true, () => false);
}

/** `pending` until the database is open; then how durable it turned out to be. */
export type StorageStatus = "pending" | StorageMode;

/**
 * Whether what the visitor types will still be here tomorrow.
 *
 * `pending` on the server and on the first client render, so the markup matches and React does not
 * warn. Then `durable`, or `memory` when the browser refused and the fallback took over. Draw
 * `memory` as a supported state with a plain warning: everything works, nothing is kept.
 */
export function useStorageStatus<Tables extends TableMap>(handle: DatabaseHandle<Tables>): StorageStatus {
  const hydrated = useIsHydrated();
  const [mode, setMode] = useState<StorageMode | undefined>(undefined);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    // Settled in a callback rather than synchronously, which is what the lint rule asks for: this
    // is a subscription to an external system, and the external system is the browser's answer to
    // "may I store anything".
    void handle.ready().then(
      () => { if (!cancelled) setMode(handle.mode() ?? "memory"); },
      () => { if (!cancelled) setMode("memory"); },
    );
    return () => { cancelled = true; };
  }, [handle, hydrated]);

  return !hydrated || !mode ? "pending" : mode;
}

export type StoredQuery<Value> = {
  data: Value | undefined;
  /** Distinguishes "still loading" from "loaded, and there is nothing". */
  isLoading: boolean;
};

/**
 * Run a Dexie query and keep it live, without rendering it on the server.
 *
 * `query` is called only in the browser, only once the database is open, and re-runs whenever the
 * data it read changes — that is Dexie's own live-query tracking, not a poll. `deps` works like
 * any hook dependency list: name every value from outside the closure.
 *
 * There is no `isUnavailable`. The query runs either way; `useStorageStatus` is what tells you
 * whether to warn about it.
 */
export function useStoredQuery<Value, Tables extends TableMap>(
  handle: DatabaseHandle<Tables>,
  query: () => Value | Promise<Value>,
  deps: readonly unknown[] = [],
): StoredQuery<Value> {
  const status = useStorageStatus(handle);
  const result = useLiveQuery(async () => {
    if (status === "pending") return undefined;
    await handle.ready();
    return { value: await query() };
    // The status has to be a dependency: the first client render reports `pending`, and without
    // it the query would never re-run once the database finished opening.
  }, [status, ...deps]);

  return {
    data: result?.value,
    isLoading: status === "pending" || result === undefined,
  };
}

export type TransferState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "imported"; result: ImportResult }
  | { kind: "error"; message: string };

/**
 * Save-to-file and load-from-file, wired for a button and a file input.
 *
 * Every application built on this package should offer both somewhere. Preview and the published
 * site are separate origins that cannot see each other's data, a browser can clear this store at
 * any time, and a visitor on the memory fallback loses everything when the tab closes. A file is
 * the answer to all three. See `docs/storage.md`.
 */
export function useDatabaseTransfer<Tables extends TableMap>(handle: DatabaseHandle<Tables>) {
  const [state, setState] = useState<TransferState>({ kind: "idle" });

  const exportToFile = useCallback(async () => {
    setState({ kind: "working" });
    try {
      const data = await exportDatabase(handle);
      downloadExport(data, exportFilename(handle));
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Export failed." });
    }
  }, [handle]);

  const importFromFile = useCallback(async (file: Blob, mode: ImportMode = "replace") => {
    setState({ kind: "working" });
    try {
      const data = parseExport(await readExportFile(file), handle);
      setState({ kind: "imported", result: await importDatabase(handle, data, { mode }) });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Import failed." });
    }
  }, [handle]);

  const reset = useCallback(async () => {
    setState({ kind: "working" });
    try {
      await handle.reset();
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Reset failed." });
    }
  }, [handle]);

  return useMemo(
    () => ({ state, exportToFile, importFromFile, reset }),
    [state, exportToFile, importFromFile, reset],
  );
}
