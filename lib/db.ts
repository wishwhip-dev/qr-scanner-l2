/**
 * This application's database.
 *
 * The reusable half of the setup is in `lib/storage/` and is not edited. This file is the half
 * that describes the product: which tables exist, what is indexed, how the schema has changed over
 * time, and what a first visit starts with.
 *
 * **The schema below is an example and nobody has data in it.** If you are building this
 * application for the first time, replace the tables in version 1 with your own, rename the
 * database, and replace or delete the seed alongside them — do not add a version 2 that drops
 * `notes`. The "never edit a shipped version" rule in `docs/storage.md` binds from your first
 * deployment onward, not before it.
 */
import { defineDatabase } from "@/lib/storage/database";

export type Note = {
  id: string;
  title: string;
  body: string;
  /** Epoch millis. Indexed, because the list is ordered by it. */
  updatedAt: number;
};

/** Ids are generated here so the data layer never depends on an auto-increment round trip. */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** What a first visit opens to. An app that opens empty looks broken. */
const SAMPLE_NOTES: Note[] = [
  {
    id: "sample-welcome",
    title: "This note came with the app",
    body: "It was written once, on your first visit. Delete it and it stays deleted — the seed does not refill a list you emptied on purpose.",
    updatedAt: Date.now(),
  },
  {
    id: "sample-storage",
    title: "Everything here lives in this browser",
    body: "No account, no sync, no other visitor can see it. Export to a file to carry it anywhere else.",
    updatedAt: Date.now() - 60_000,
  },
];

export const database = defineDatabase<{ notes: Note }>({
  // Part of the origin's storage identity. Renaming it does not migrate anything — it points the
  // application at a different, empty database and abandons the old one in place. That is exactly
  // what you want on a first build, and never what you want afterwards.
  name: "starter-app",
  versions: [
    // Only the primary key and the properties queried on. `title` and `body` are stored but never
    // filtered or sorted by, so indexing them would cost writes and buy nothing.
    { version: 1, stores: { notes: "id, updatedAt" } },
  ],
  // Written once, inside `ready()`, in one transaction with its own marker. Do not hand-roll this:
  // no `meta` table, no flag, no promise to dedupe a double mount — see `docs/storage.md`.
  seed: {
    tables: ["notes"],
    run: async (db) => { await db.notes.bulkAdd(SAMPLE_NOTES); },
  },
});
