/**
 * GENERATED FILE — do not edit here.
 *
 * Vendored from the supervisor repository's `packages/app-storage` at version 0.3.0.
 * A later copy of the package replaces this file, so an edit made here is lost.
 * Anything this product needs that the shared code does not do belongs in lib/db.ts, lib/data/,
 * or a new module of your own.
 */
/**
 * Dexie setup, shared by every generated application.
 *
 * What lives here is the part that is the same in all of them: creating the instance lazily,
 * declaring versions in order, and — since 0.2.0 — falling back to an in-memory database when the
 * browser refuses to store anything. What does NOT live here is any table, index, query or
 * migration; those describe one product and belong in that product's `lib/db.ts`.
 *
 * ## Why there is a fallback at all
 *
 * 0.1.0 reported `isUnavailable` and left it there. Measured on the first real application built
 * on it, that cost about 120 lines per app: the agent wrote a second data module over a plain
 * array, a `useSyncExternalStore` harness to make it reactive, a hand-rebuilt export envelope and
 * import merge, and a ternary at every call site choosing between the two. All of it generic, all
 * of it rewritten from scratch by the next application.
 *
 * A fake IndexedDB is a far better answer than a hand-written array, because the whole Dexie API
 * keeps working: the same queries, the same indexes, the same transactions, the same export and
 * import. The data layer is written once and does not know which one it got. Nothing survives a
 * reload — which is exactly the semantics a refused browser store should have.
 *
 * The fallback is `import()`ed, so it is a separate chunk that is only fetched by the visitors who
 * actually need it.
 */
import Dexie, { type Table, type Transaction } from "dexie";
import { seedOnce, SEED_META_TABLE, type SeedDefinition, type SeedResult } from "./seed";

/** A Dexie store declaration: `"++id, name, *tags"`. Keyed by table name. */
export type StoreDefinitions = Record<string, string | null>;

export type SchemaVersion = {
  /** Dexie version number. Must increase; see `docs/storage.md` for the rules on changing one. */
  version: number;
  /**
   * Only the tables and indexes that CHANGE in this version, exactly as Dexie wants them.
   * Dexie carries unchanged stores forward on its own; `null` drops a table.
   */
  stores: StoreDefinitions;
  /** Runs once, on the upgrade to this version, inside Dexie's transaction. */
  upgrade?: (transaction: Transaction) => void | PromiseLike<unknown>;
};

export type TableMap = Record<string, object>;

export type AppDatabase<Tables extends TableMap> = Dexie & {
  readonly [Name in keyof Tables]: Table<Tables[Name]>;
};

/**
 * Where the data actually ended up.
 *
 * `durable` — the browser's own IndexedDB. It is still there after a reload.
 * `memory` — an in-memory stand-in, because this browser refused. Everything works for the
 *   session and nothing survives closing the tab. Say so on screen; do not fail.
 */
export type StorageMode = "durable" | "memory";

/**
 * Thrown only when the database is reached for somewhere it cannot exist at all — during server
 * rendering. A browser that refuses IndexedDB no longer throws; it gets the memory fallback.
 */
export class StorageUnavailableError extends Error {
  constructor(readonly reason: "server", message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export type DatabaseHandle<Tables extends TableMap> = {
  readonly name: string;
  /** The highest declared schema version. Travels with an export so an import can check it. */
  readonly schemaVersion: number;
  /** The table names this schema declares, after every version has been applied. */
  readonly tableNames: readonly string[];
  /**
   * An open database — the browser's, or the in-memory stand-in. Resolves in both cases, so a
   * data-access module never branches. Rejects only during server rendering.
   *
   * Safe to call on every query: after the first call it is the same instance.
   */
  ready: () => Promise<AppDatabase<Tables>>;
  /** The instance if `ready()` has already resolved, else undefined. */
  current: () => AppDatabase<Tables> | undefined;
  /** Which kind of store `ready()` produced, or undefined before it resolves. */
  mode: () => StorageMode | undefined;
  /** Whether this context can open the browser's own IndexedDB. Cheap and synchronous. */
  isAvailable: () => boolean;
  /** What the declared seed did, once `ready()` has resolved. Undefined when none is declared. */
  seedResult: () => SeedResult | undefined;
  close: () => Promise<void>;
  /** Deletes everything. Used by "reset" actions and by a replacing import. */
  reset: () => Promise<void>;
};

/** Whether this context has the browser's IndexedDB. False on the server and in opaque origins. */
export function isStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Reading `window.indexedDB` is itself what throws in a frame whose origin is opaque —
    // the property access is a SecurityError, not the later `open()` call.
    return Boolean(window.indexedDB);
  } catch {
    return false;
  }
}

const SERVER_MESSAGE =
  "The database was opened during server rendering. Move the call into a \"use client\" component, an effect, or an event handler.";

/**
 * Declare an application's database.
 *
 * Versions are sorted by number and applied in order, so they can be listed however reads best in
 * the calling module. Declaring the same version twice is a mistake Dexie reports at open time as
 * a confusing schema error, so it is rejected here where the stack trace still points at the
 * declaration.
 */
export function defineDatabase<Tables extends TableMap>(options: {
  name: string;
  versions: readonly SchemaVersion[];
  /**
   * Example content to write on a first run. See `seed.ts`.
   *
   * Declaring this adds a private `_appMeta` store to the lowest declared version, to hold the
   * marker. That is a schema change, which is why it is conditional: an application that declares
   * no seed gets byte-identical behaviour to a build without this feature, so raising its vendored
   * copy of this package cannot alter a schema version its users have already opened.
   *
   * Declare a seed before the application ships, not after.
   */
  seed?: SeedDefinition<Tables>;
}): DatabaseHandle<Tables> {
  const versions = [...options.versions].sort((a, b) => a.version - b.version);
  if (versions.length === 0) throw new Error(`Database "${options.name}" declares no versions.`);
  const duplicate = versions.find((entry, index) => index > 0 && entry.version === versions[index - 1]?.version);
  if (duplicate) throw new Error(`Database "${options.name}" declares version ${duplicate.version} twice.`);

  // Applied in order rather than collected, because a `null` in a later version drops a table and
  // the name must go with it. `exportDatabase` reads this list, and a name left in it after the
  // table was dropped is a table the export would look for and not find.
  const live = new Set<string>();
  for (const entry of versions) {
    for (const [name, definition] of Object.entries(entry.stores)) {
      if (definition === null) live.delete(name);
      else live.add(name);
    }
  }
  // The marker store is infrastructure, not product data: it is excluded here so `exportDatabase`
  // never writes it into a file and `importDatabase` never restores one application's "already
  // seeded" flag into another.
  const tableNames = [...live].filter((name) => name !== SEED_META_TABLE);

  let instance: AppDatabase<Tables> | undefined;
  let opening: Promise<AppDatabase<Tables>> | undefined;
  let mode: StorageMode | undefined;
  let seeded: SeedResult | undefined;

  const runSeed = async (database: AppDatabase<Tables>): Promise<void> => {
    if (!options.seed) return;
    seeded = await seedOnce(database, options.seed);
  };

  const build = (dependencies?: { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange }): AppDatabase<Tables> => {
    const database = new Dexie(options.name, dependencies) as AppDatabase<Tables>;
    for (const [index, entry] of versions.entries()) {
      // Added to the lowest version so it exists from the first open, rather than as a new version
      // that every already-installed browser would have to upgrade through.
      const stores = index === 0 && options.seed
        ? { ...entry.stores, [SEED_META_TABLE]: "key" }
        : entry.stores;
      const declared = database.version(entry.version).stores(stores);
      if (entry.upgrade) declared.upgrade(entry.upgrade);
    }
    return database;
  };

  const create = async (): Promise<AppDatabase<Tables>> => {
    if (typeof window === "undefined") throw new StorageUnavailableError("server", SERVER_MESSAGE);
    if (isStorageAvailable()) {
      try {
        const database = build();
        // Opened here rather than lazily, because "IndexedDB exists" and "IndexedDB will let me
        // open a database" are different questions. Private-browsing modes answer the first yes
        // and the second no, and only `open()` asks the second.
        await database.open();
        mode = "durable";
        await runSeed(database);
        return database;
      } catch {
        // Fall through. The browser has the API and refused to use it.
      }
    }
    const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
    const database = build({ indexedDB, IDBKeyRange });
    await database.open();
    mode = "memory";
    // Seeded on the fallback too: a private window should still look like the product rather than
    // like a broken one, even though nothing it holds survives the tab closing.
    await runSeed(database);
    return database;
  };

  const ready = (): Promise<AppDatabase<Tables>> => {
    if (instance) return Promise.resolve(instance);
    // Deduplicated: a screen with six live queries calls this six times on its first render, and
    // six concurrent `open()` calls against one database is a race worth not having.
    opening ??= create().then((database) => {
      instance = database;
      opening = undefined;
      return database;
    }, (error: unknown) => {
      opening = undefined;
      throw error;
    });
    return opening;
  };

  return {
    name: options.name,
    schemaVersion: versions[versions.length - 1]!.version,
    tableNames,
    ready,
    current: () => instance,
    mode: () => mode,
    isAvailable: isStorageAvailable,
    seedResult: () => seeded,
    close: async () => {
      instance?.close();
      instance = undefined;
      opening = undefined;
      mode = undefined;
    },
    reset: async () => {
      const database = instance ?? await ready();
      // The instance's own `delete`, not `Dexie.delete(name)`: the latter goes through the global
      // indexedDB, which is the wrong factory entirely when running on the memory fallback.
      await database.delete();
      instance = undefined;
      opening = undefined;
      mode = undefined;
      // Cleared so a reset re-seeds: "reset to factory" should give back the example content, and
      // `reset` deletes the marker store along with everything else anyway.
      seeded = undefined;
    },
  };
}
