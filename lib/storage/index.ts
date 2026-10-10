/**
 * GENERATED FILE — do not edit here.
 *
 * Vendored from the supervisor repository's `packages/app-storage` at version 0.3.0.
 * A later copy of the package replaces this file, so an edit made here is lost.
 * Anything this product needs that the shared code does not do belongs in lib/db.ts, lib/data/,
 * or a new module of your own.
 */
export {
  defineDatabase,
  isStorageAvailable,
  StorageUnavailableError,
  type AppDatabase,
  type DatabaseHandle,
  type StorageMode,
  type SchemaVersion,
  type StoreDefinitions,
  type TableMap,
} from "./database";

export {
  seedOnce,
  SEED_META_TABLE,
  type SeedDefinition,
  type SeedResult,
  type SeedStatus,
} from "./seed";

export {
  downloadExport,
  exportDatabase,
  exportFilename,
  importDatabase,
  ImportError,
  parseExport,
  readExportFile,
  serializeExport,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  type ImportMode,
  type ImportResult,
  type StorageExport,
} from "./transfer";
