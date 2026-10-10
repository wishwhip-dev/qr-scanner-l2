<!--
  GENERATED FILE — do not edit here.

  The source of this document lives in the supervisor repository at
  `packages/app-storage/docs/storage.md`, and it is copied into every application built from a
  template with browser storage. An edit made here only changes this application's copy.
-->

# Storage

This project stores data **in the browser, on one device**, using [Dexie](https://dexie.org) over
IndexedDB. The reusable half of that setup is already written and lives in `lib/storage/`. The
half that describes this product — its tables, its queries, its migrations — lives in `lib/db.ts`
and `lib/data/`.

**Extend what is here. Do not add a second storage layer.** A working database, an example schema,
data-access functions, a CRUD screen and export/import are all in place; a task that needs to
remember something adds a table and some functions to that, and does not install another client,
reach for `localStorage`, or scaffold an ORM.

## What this is, and what it is not

Dexie is a wrapper over IndexedDB. Everything written through it lands in the visitor's own
browser, under the origin the page was served from. That has consequences worth being exact about,
because they decide what this project can honestly promise a user:

- **It is per-device and per-browser.** The same person on their laptop and on their phone has two
  separate sets of data. So does the same person in a normal window and a private one.
- **There is no sync.** Nothing propagates between devices, browsers, or tabs on different
  machines. (Within one browser, live queries do update across tabs.) Where this project ships
  `docs/sync.md`, the person can move everything to another device once, with a code: a one-time
  copy they start, not sync.
- **There is no sharing.** One visitor cannot see another's data. There are no accounts, no
  permissions, and no server holding a shared copy. A "share this list with a friend" feature
  cannot be built on this — an export file they send by hand is the closest honest version.
- **It is not a backup.** Clearing site data, "reset browser", some privacy modes, and storage
  pressure eviction all delete it without warning.

**Origins are the thing that surprises people.** Storage is scoped to the origin. The preview URL
and the published URL are *different origins*, so data entered in preview is not in the published
app, and vice versa. This is not a bug and cannot be configured away. It is why export/import
exists, and why every app built here should offer it.

## When the browser says no

Some browsers refuse IndexedDB — private-browsing modes, blocked site data, frames served from an
opaque origin. **You do not have to code for this.** `lib/storage/` falls back to an in-memory
database automatically, and it is a real Dexie database: the same queries, indexes, transactions,
export and import all work. Your data-access modules are written once and never learn which one
they got.

What it does not do is survive a reload. So the one thing to add is a line of interface saying so:

```tsx
const status = useStorageStatus(database); // "pending" | "durable" | "memory"
{status === "memory" && <Banner>This browser will not keep your data. Export it to a file.</Banner>}
```

Never branch your data layer on this. There is one path.

## The files

```
lib/storage/         the shared package, vendored in. Do not edit — see "Updating" below.
  database.ts        defineDatabase, isStorageAvailable, StorageUnavailableError
  seed.ts            seedOnce — example content, written once. See below.
  transfer.ts        exportDatabase, importDatabase, parseExport, downloadExport
  react.ts           useStoredQuery, useStorageStatus, useDatabaseTransfer
  VERSION            which release of the shared package this copy is
lib/db.ts            THIS app's schema. Tables, indexes, versions, migrations.
lib/data/notes.ts    THIS app's data-access functions. Components call these, not Dexie.
```

## Declaring a schema

`lib/db.ts` is the only place a table is declared:

```ts
import { defineDatabase } from "@/lib/storage/database";

export type Note = { id: string; title: string; body: string; updatedAt: number };

export const database = defineDatabase<{ notes: Note }>({
  name: "notes-app",
  versions: [{ version: 1, stores: { notes: "id, updatedAt" } }],
});
```

The store string is Dexie's: the first entry is the primary key, the rest are indexed properties,
`++` means auto-incrementing, `*` a multi-entry index, `&` unique. **Index only what you query on.**
Properties that are merely stored do not belong in the string.

`defineDatabase` creates nothing until `ready()` is awaited, so this module is safe to import from
a server component.

## Building this app for the first time? Rewrite version 1.

The schema shipped in `lib/db.ts` is an **example**, and nobody has data in it. Your product is
version 1. Replace the tables in that version-1 entry with your own, rename the database, and
delete the example — do not add a version 2 that drops the example's tables. An application whose
first release carries a migration away from a table it never used has inherited someone else's
history for no reason.

The rule in the next section binds from your first deployment onward, once real browsers are
holding real rows.

## Starting with example content

An app that opens empty looks broken. Declare a seed on the database and it is written once, on a
first run, inside `ready()` — so every query in the app is already post-seed and the empty state
cannot flash before the rows arrive:

```ts
export const database = defineDatabase<{ notes: Note }>({
  name: "notes-app",
  versions: [{ version: 1, stores: { notes: "id, updatedAt" } }],
  seed: {
    tables: ["notes"],
    run: async (db) => { await db.notes.bulkAdd(SAMPLE_NOTES); },
  },
});
```

**Do not write this by hand.** No `meta` table, no `SEED_FLAG`, no module-level promise to stop a
double mount seeding twice — all three are already in `lib/storage/`, and the behaviour that is
easy to get wrong is already correct:

- It will not re-seed for a returning visitor.
- It will **not** refill a list the visitor deliberately emptied. A row-count check gets this wrong,
  and gets it wrong only for the people who cared enough to clear it.
- It will never write example content on top of rows that are already there.
- A seed that throws leaves the database open and empty rather than breaking the app.

Bump `seed.id` when the example content itself changes and existing visitors should get the new
set. `reset()` clears the marker along with everything else, so a reset re-seeds — which is what
"reset to factory" should mean.

Declaring a seed adds a private `_appMeta` store to your lowest schema version. Declare it **before
the app ships**: adding one later changes a version that browsers have already opened.

## Changing a schema without losing data

This is the rule that matters most once the app is live, because an application here is revised
repeatedly and its users have real data in it by the second revision.

**Never edit a version that has shipped. Add a new one.**

```ts
versions: [
  { version: 1, stores: { notes: "id, updatedAt" } },
  // v2 adds an index and backfills the new field. v1 is left exactly as it was.
  {
    version: 2,
    stores: { notes: "id, updatedAt, pinned" },
    upgrade: (tx) => tx.table("notes").toCollection().modify((note) => {
      note.pinned = false;
    }),
  },
]
```

- Bump the number and list **only what changed**. Dexie carries unchanged stores forward.
- A new optional field needs no migration at all — old rows simply lack it. Read it as optional,
  or backfill it in `upgrade` if the rest of the code would rather it always existed.
- A new *index* on an existing table does need a version bump, even when no data changes.
- `upgrade` runs once per browser, inside Dexie's transaction. Keep it total: it will meet rows
  written by every earlier version, including ones written by a build that has since been changed.
- Renaming a field is a copy in `upgrade`, then a delete — not an edit to a shipped version.
- Dropping a table is `{ theTable: null }` in a new version. Only do it when the data is genuinely
  dead; there is no undo and no server copy.

Editing a shipped version 1 instead of adding version 2 is the mistake to avoid. Browsers that
already ran version 1 will not re-run it, so they keep the old shape while the code expects the
new one, and the failure appears only for users who were there before the change — never in a
fresh preview, which is where the change gets tested.

## Reading and writing

Components never call Dexie directly. Put the queries in `lib/data/`, one module per area, and
call those:

```ts
// lib/data/notes.ts
import { database, type Note } from "@/lib/db";

const notes = async () => (await database.ready()).notes;

export async function listNotes(): Promise<Note[]> {
  return (await notes()).orderBy("updatedAt").reverse().toArray();
}

export async function saveNote(note: Note): Promise<void> {
  await (await notes()).put(note);
}
```

`ready()` resolves to an open database every time — the browser's, or the in-memory stand-in. It
opens once however many callers ask.

In a client component, `useStoredQuery` keeps a read live and tells you which state you are in:

```tsx
"use client";
import { useStoredQuery } from "@/lib/storage/react";
import { database } from "@/lib/db";
import { listNotes } from "@/lib/data/notes";

const { data, isLoading } = useStoredQuery(database, listNotes);
if (isLoading) return <Skeleton />;
if (!data?.length) return <EmptyState />;
```

`isLoading` and "there are no rows" are different states. Drawing them the same way is why an app
flashes its empty state on every load, or spins forever on a database that is legitimately empty.

Writes need no refetch — any `useStoredQuery` reading the affected table re-runs by itself.

Two mistakes to avoid. **Do not load data with `useEffect` plus a state setter**: it fails lint
(`react-hooks/set-state-in-effect`) and renders differently on the server; `useStoredQuery` is
that pattern done correctly. **Await every write and show its failure**: a `saveNote(...)` that is
not awaited, or whose error is caught and dropped, loses the data silently, and the first sign is
an empty list after a reload.

## Export and import

Because preview and production are different origins, because a browser can clear this data at any
time, and because a visitor on the memory fallback loses everything when the tab closes, the owner
needs a way to carry it. `useDatabaseTransfer` is wired for exactly that:

```tsx
const { state, exportToFile, importFromFile, reset } = useDatabaseTransfer(database);
```

`exportToFile` downloads a JSON file of every table. `importFromFile(file, "replace" | "merge")`
validates the envelope first — application name and schema version — and applies it in one
transaction, so a bad file changes nothing. Keep both reachable in any app you build here.

## Updating

`lib/storage/` is a vendored copy of a shared package, stamped in `lib/storage/VERSION`. Edits to
it are overwritten by the next sync from the supervisor repository, and every application pinned
to a given version keeps the behaviour it was built against until that version is deliberately
raised. Anything this product needs that the shared code does not do belongs in `lib/db.ts`,
`lib/data/`, or a new module — not in `lib/storage/`.
