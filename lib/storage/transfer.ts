/**
 * GENERATED FILE — do not edit here.
 *
 * Vendored from the supervisor repository's `packages/app-storage` at version 0.3.0.
 * A later copy of the package replaces this file, so an edit made here is lost.
 * Anything this product needs that the shared code does not do belongs in lib/db.ts, lib/data/,
 * or a new module of your own.
 */
/**
 * Export and import, which are not a convenience here — they are the only way data moves.
 *
 * Everything this package stores lives in one browser's IndexedDB, under one origin. A preview
 * and a published deployment are different origins, so an application the owner tried out in
 * preview and then published starts empty the second time; so does the same application opened
 * on a phone. A file the owner can save and load back is the answer to all of those, and it is
 * cheap enough that every application should ship it.
 *
 * The envelope carries the database name and schema version so an import can refuse a file from
 * a different application, or one written by a newer schema than this build understands, instead
 * of scattering unreadable rows across the tables.
 *
 * Both work unchanged on the in-memory fallback, because it is a real Dexie database. A visitor in
 * a private window can still export what they typed and load it somewhere it will be kept, which
 * is the one thing that makes that session worth anything.
 */
import type { DatabaseHandle, TableMap } from "./database";
import { SEED_META_TABLE } from "./seed";

export const EXPORT_FORMAT = "app-storage-export" as const;
export const EXPORT_FORMAT_VERSION = 1 as const;

export type StorageExport = {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  /** The database this came out of. An import into a different one is refused. */
  database: string;
  /** The schema version at export time. A file from a newer schema is refused. */
  schemaVersion: number;
  exportedAt: string;
  /** Row arrays keyed by table name. Tables absent from the file are left alone on import. */
  tables: Record<string, unknown[]>;
};

export class ImportError extends Error {
  constructor(readonly reason: "unreadable" | "wrong-format" | "wrong-database" | "newer-schema", message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** Every row of every declared table, read in one transaction so the file is self-consistent. */
export async function exportDatabase<Tables extends TableMap>(
  handle: DatabaseHandle<Tables>,
): Promise<StorageExport> {
  const database = await handle.ready();
  const declared = new Set(database.tables.map((table: { name: string }) => table.name));
  const names = handle.tableNames.filter((name) => declared.has(name));
  const tables: Record<string, unknown[]> = {};
  await database.transaction("r", names.map((name) => database.table(name)), async () => {
    for (const name of names) tables[name] = await database.table(name).toArray();
  });
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    database: handle.name,
    schemaVersion: handle.schemaVersion,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

export function serializeExport(data: StorageExport): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Read a file back into an envelope, or say precisely why it cannot be.
 *
 * Validated before anything is written, because a half-applied import is worse than a refused
 * one: the owner loses the data that was already there and does not get the data in the file.
 */
export function parseExport<Tables extends TableMap>(
  text: string,
  handle: DatabaseHandle<Tables>,
): StorageExport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError("unreadable", "That file is not valid JSON.");
  }
  if (!raw || typeof raw !== "object") throw new ImportError("wrong-format", "That file is not an export from this application.");
  const candidate = raw as Partial<StorageExport>;
  if (candidate.format !== EXPORT_FORMAT || candidate.formatVersion !== EXPORT_FORMAT_VERSION || !candidate.tables || typeof candidate.tables !== "object") {
    throw new ImportError("wrong-format", "That file is not an export from this application.");
  }
  if (candidate.database !== handle.name) {
    throw new ImportError("wrong-database", `That file holds data for "${candidate.database}", not for this application.`);
  }
  if (typeof candidate.schemaVersion === "number" && candidate.schemaVersion > handle.schemaVersion) {
    throw new ImportError("newer-schema", "That file was saved by a newer version of this application. Update it, then import again.");
  }
  return candidate as StorageExport;
}

export type ImportMode =
  /** Empty every table the file mentions, then write the file's rows. The owner's own backup. */
  | "replace"
  /** `bulkPut` the file's rows over what is there, matching on primary key. */
  | "merge";

export type ImportResult = { tables: Record<string, number>; rows: number };

/**
 * Apply an envelope. One transaction over every affected table, so a failure leaves nothing
 * half-written and the owner still has what they had.
 *
 * Tables in the file that this build no longer declares are skipped rather than failing the
 * import — an older export is exactly the case this exists for.
 */
export async function importDatabase<Tables extends TableMap>(
  handle: DatabaseHandle<Tables>,
  data: StorageExport,
  options: { mode?: ImportMode } = {},
): Promise<ImportResult> {
  const mode = options.mode ?? "replace";
  const database = await handle.ready();
  const declared = new Set(database.tables.map((table: { name: string }) => table.name));
  // `_appMeta` is infrastructure. A hand-edited file that set the seed marker would stop this
  // application ever writing its example content, for a reason nobody could find.
  const names = Object.keys(data.tables).filter((name) => declared.has(name) && name !== SEED_META_TABLE);
  const counts: Record<string, number> = {};
  await database.transaction("rw", names.map((name) => database.table(name)), async () => {
    for (const name of names) {
      const rows = Array.isArray(data.tables[name]) ? data.tables[name] : [];
      if (mode === "replace") await database.table(name).clear();
      if (rows.length) await database.table(name).bulkPut(rows as object[]);
      counts[name] = rows.length;
    }
  });
  return { tables: counts, rows: Object.values(counts).reduce((total, count) => total + count, 0) };
}

/** A filename that sorts by date and says which application it came from. */
export function exportFilename(handle: { name: string }, now = new Date()): string {
  return `${handle.name}-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Hand the serialized export to the browser as a download.
 *
 * Separate from `exportDatabase` so the data can also be sent somewhere else — a clipboard, a
 * textarea, a test — without a DOM. The object URL is revoked on the next frame; revoking it
 * synchronously cancels the download in Safari.
 */
export function downloadExport(data: StorageExport, filename = exportFilename({ name: data.database })): void {
  const blob = new Blob([serializeExport(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Read a file the owner picked. Paired with `parseExport` by `useDatabaseTransfer`. */
export async function readExportFile(file: Blob): Promise<string> {
  return file.text();
}
