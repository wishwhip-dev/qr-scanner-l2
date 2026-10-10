/**
 * GENERATED FILE — do not edit here.
 *
 * Vendored from the supervisor repository's `packages/app-storage` at version 0.3.0.
 * A later copy of the package replaces this file, so an edit made here is lost.
 * Anything this product needs that the shared code does not do belongs in lib/db.ts, lib/data/,
 * or a new module of your own.
 */
/**
 * Starting a database with example content, exactly once.
 *
 * Every application built on this package so far has written this by hand, and written the same
 * forty lines: a key-value table, a flag, a transaction, and a module-level promise to stop a
 * React double-mount seeding twice. Two out of two. The semantics are also easy to get subtly
 * wrong in a way nobody notices until a user complains — see `already-seeded` below.
 *
 * Declared on `defineDatabase({ seed })` and run inside `ready()`, so every query in the app is
 * automatically post-seed and the empty state cannot flash before the rows arrive.
 */
import type { AppDatabase, TableMap } from "./database";

/** The private store the marker lives in. Created only when a seed is declared. */
export const SEED_META_TABLE = "_appMeta";

export type SeedDefinition<Tables extends TableMap> = {
  /**
   * Changes the marker, so a new one seeds again over an old one. Defaults to `"1"`.
   * Bump it when the example content itself changes and existing users should get the new set.
   */
  id?: string;
  /** The tables the seed writes. Checked for emptiness and locked for the transaction. */
  tables: readonly (keyof Tables & string)[];
  /** Writes the rows. Runs inside a transaction that already covers `tables`. */
  run: (database: AppDatabase<Tables>) => void | PromiseLike<unknown>;
};

export type SeedStatus =
  /** Rows were written. */
  | "seeded"
  /** The marker was already there. */
  | "already-seeded"
  /** A table had rows before this ran, so the marker was written and nothing else. */
  | "not-empty"
  /** The seed threw. The database is still usable and still unseeded. */
  | "failed";

export type SeedResult = { status: SeedStatus; error?: unknown };

/**
 * Write the example content once, in one transaction with its own marker.
 *
 * The marker decides, not the row count. That is the whole subtlety: a visitor who deliberately
 * deletes everything must come back to the empty list they left, not to a list that quietly
 * refilled itself. Counting rows gets that wrong, and gets it wrong only for the people who
 * cared enough to clear it.
 *
 * A table that already has rows is the other direction: an application that gains a seed after
 * people have been using it must never write example content on top of real data. The marker is
 * set anyway so it stops asking.
 */
export async function seedOnce<Tables extends TableMap>(
  database: AppDatabase<Tables>,
  seed: SeedDefinition<Tables>,
): Promise<SeedResult> {
  const marker = `seed:${seed.id ?? "1"}`;
  const meta = database.table(SEED_META_TABLE);
  const tables = [...seed.tables.map((name) => database.table(name)), meta];

  try {
    let status: SeedStatus = "seeded";
    await database.transaction("rw", tables, async () => {
      if (await meta.get(marker)) {
        status = "already-seeded";
        return;
      }
      for (const name of seed.tables) {
        if ((await database.table(name).count()) > 0) {
          await meta.put({ key: marker, value: "1" });
          status = "not-empty";
          return;
        }
      }
      await seed.run(database);
      await meta.put({ key: marker, value: "1" });
    });
    return { status };
  } catch (error) {
    // Never fatal. An application that will not open because its example content threw is a worse
    // outcome than one that opens empty, and the second is recoverable by the person using it.
    console.warn("[app-storage] seed failed; the database is open and empty.", error);
    return { status: "failed", error };
  }
}
