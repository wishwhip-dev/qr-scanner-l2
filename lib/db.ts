/**
 * This application's database.
 *
 * The reusable half of the setup is in `lib/storage/` and is not edited. This file is the half
 * that describes the product: which tables exist, what is indexed, how the schema has changed over
 * time, and what a first visit starts with.
 *
 * This app keeps one thing: the history of QR codes scanned, newest first, capped at the last 20.
 * The history is intentionally empty on a first visit — a scanner with made-up scans in it would
 * be lying — so there is no seed; the page shows its own "No scans yet" state.
 */
import { defineDatabase } from "@/lib/storage/database";

/** One decoded QR code, when it was read. */
export type Scan = {
  id: string;
  /** The decoded text, exactly as the code read it. */
  text: string;
  /** Epoch millis. Indexed, because the history is ordered by it. */
  scannedAt: number;
};

/** Ids are generated here so the data layer never depends on an auto-increment round trip. */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const database = defineDatabase<{ scans: Scan }>({
  // Part of the origin's storage identity. Renaming it does not migrate anything — it points the
  // application at a different, empty database and abandons the old one in place.
  name: "qr-scanner",
  versions: [
    // Only the primary key and the properties queried on. `text` is stored but never filtered or
    // sorted by, so indexing it would cost writes and buy nothing.
    { version: 1, stores: { scans: "id, scannedAt" } },
  ],
});
