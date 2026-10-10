"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { database, type Scan } from "@/lib/db";
import { clearScans, deleteScan, listScans, restoreScan, SCAN_HISTORY_LIMIT } from "@/lib/data/scans";
import { useStoredQuery } from "@/lib/storage/react";
import { toast } from "sonner";

/**
 * The scan history: the last 20 scans, newest first, kept in the browser's own database.
 *
 * Each row shows the decoded text (truncated past ~80 characters) and when it was read; tapping
 * the row expands it to the full text. Copy copies that row's text, Delete removes it — with an
 * Undo in the toast, since a mistaken tap on a row is easy — and Clear history empties the list
 * after asking, because it destroys every row at once.
 */

/** Rows truncate past this many characters until the row is tapped open. */
const ROW_TRUNCATE = 80;

function formatTime(scannedAt: number): string {
  return new Date(scannedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function truncate(text: string): string {
  return text.length > ROW_TRUNCATE ? `${text.slice(0, ROW_TRUNCATE).trimEnd()}…` : text;
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        if (!document.execCommand("copy")) throw new Error("the copy command was refused");
      } finally {
        area.remove();
      }
    }
    toast.success("Copied to clipboard");
  } catch (error) {
    toast.error(`Could not copy: ${error instanceof Error ? error.message : "the browser refused"}.`);
  }
}

function HistoryRow({ scan }: { scan: Scan }) {
  const [open, setOpen] = useState(false);
  const shown = open ? scan.text : truncate(scan.text);

  const remove = async () => {
    try {
      await deleteScan(scan.id);
      toast("Scan deleted", {
        action: { label: "Undo", onClick: () => void restoreScan(scan).catch(() => toast.error("Could not undo the delete.")) },
      });
    } catch (error) {
      toast.error(`Could not delete the scan: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  };

  return (
    <li className="flex items-start gap-1 rounded-md border bg-card p-2">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="min-w-0 min-h-8 flex-1 rounded-sm px-1 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className={open ? "block whitespace-pre-wrap break-words text-sm" : "block truncate text-sm"} title={open ? undefined : scan.text}>
          {shown}
        </span>
        <time dateTime={new Date(scan.scannedAt).toISOString()} className="mt-0.5 block text-xs text-muted-foreground">
          {formatTime(scan.scannedAt)}
        </time>
        <span className="sr-only">{open ? ". Tap to collapse" : ". Tap to show the full text"}</span>
      </button>
      <div className="flex shrink-0 gap-1">
        <Button type="button" variant="outline" size="sm" className="min-h-8" onClick={() => void copyText(scan.text)}>
          Copy
        </Button>
        <Button type="button" variant="outline" size="sm" className="min-h-8 text-destructive hover:text-destructive" onClick={() => void remove()}>
          Delete
        </Button>
      </div>
    </li>
  );
}

export function ScanHistory() {
  const { data, isLoading } = useStoredQuery(database, listScans);
  const [clearing, setClearing] = useState(false);
  const scans = data ?? [];

  const clearAll = async () => {
    const count = scans.length;
    if (!window.confirm(count === 1 ? "Delete the 1 scan in the history?" : `Delete all ${count} scans in the history? This cannot be undone.`)) return;
    setClearing(true);
    try {
      await clearScans();
      toast.success("History cleared");
    } catch (error) {
      toast.error(`Could not clear the history: ${error instanceof Error ? error.message : "unknown error"}.`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <section aria-labelledby="recent-scans-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recent-scans-heading" className="text-lg font-semibold tracking-tight">
          Recent scans
          {scans.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {scans.length} of {SCAN_HISTORY_LIMIT}
            </span>
          )}
        </h2>
        {scans.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="min-h-8 text-destructive hover:text-destructive" disabled={clearing} onClick={() => void clearAll()}>
            Clear history
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : scans.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          No scans yet. Codes you scan with the camera or decode from an image are kept here — the last {SCAN_HISTORY_LIMIT}, on this device.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {scans.map((scan) => (
            <HistoryRow key={scan.id} scan={scan} />
          ))}
        </ul>
      )}
    </section>
  );
}