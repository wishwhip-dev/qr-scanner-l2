/**
 * The scan history: every query and write the page makes, in one place. Components call these,
 * never Dexie directly.
 *
 * The history holds at most the last 20 scans, newest first. Writing a 21st scan drops the
 * oldest, so the list never grows past the cap. An identical read straight after itself is
 * recorded once, not once per camera frame: holding one code in view adds it a single time until
 * a different code is scanned.
 */
import { database, newId, type Scan } from "@/lib/db";

/** How many scans the history keeps. */
export const SCAN_HISTORY_LIMIT = 20;

const scans = async () => (await database.ready()).scans;

/** The last 20 scans, newest first. */
export async function listScans(): Promise<Scan[]> {
  return (await scans()).orderBy("scannedAt").reverse().limit(SCAN_HISTORY_LIMIT).toArray();
}

/**
 * Record a decoded text with the current time. Resolves to the saved scan, or null when the
 * write was skipped because the newest scan already holds exactly this text — an identical
 * consecutive read is kept once, not twice.
 */
export async function addScan(text: string, scannedAt = Date.now()): Promise<Scan | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const table = await scans();
  const newest = await table.orderBy("scannedAt").last();
  if (newest && newest.text === trimmed) return null;

  const scan: Scan = { id: newId(), text: trimmed, scannedAt };
  await table.put(scan);
  // The table is tiny (at most the cap plus this one), so trimming reads it whole.
  const all = await table.orderBy("scannedAt").toArray();
  const extra = all.slice(0, Math.max(0, all.length - SCAN_HISTORY_LIMIT)).map((scan) => scan.id);
  if (extra.length) await table.bulkDelete(extra);
  return scan;
}

/** Remove one scan. The id comes from a row the page is already showing. */
export async function deleteScan(id: string): Promise<void> {
  await (await scans()).delete(id);
}

/** Empty the whole history, as "Clear history" promises. */
export async function clearScans(): Promise<void> {
  await (await scans()).clear();
}
