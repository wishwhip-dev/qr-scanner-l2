"use client";

import { useState } from "react";
import { ShareButton } from "@/components/share-button";
import { Button } from "@/components/ui/button";
import { identity } from "@/app/identity";
import { isUrl } from "@/lib/qr";
import { renderShareCard } from "@/lib/share";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * The decoded text of the most recent scan, with what one does to it.
 *
 * - The text is selectable, and a web address is a real link that opens in a new tab — while
 *   Copy still copies the raw text either way.
 * - Copy confirms twice: the button says "Copied" for a moment and a toast confirms it. When the
 *   browser will not copy programmatically, a hidden textarea fallback tries the older way, and
 *   if that fails too the person is told rather than left to assume.
 * - Share hands the decoded text to the device's share sheet — as a link when it is one, as a
 *   share card otherwise — and copies or saves where there is no sheet.
 * - `captureCount` ticks up on every new capture; the card lights up for a moment as the
 *   sound-free confirmation that a scan was taken.
 */

export type ScanResultData = {
  text: string;
  source: "camera" | "image";
  at: number;
};

/** Split the text into short card lines, since a QR payload can be far longer than a card line. */
function cardLines(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > 60) {
      if (line) lines.push(line);
      line = word.length > 60 ? word.slice(0, 60) : word;
    } else {
      line = (line ? line + " " : "") + word;
    }
    if (lines.length >= 6) return lines;
  }
  if (line && lines.length < 6) lines.push(line);
  return lines;
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Older browsers: a hidden selection and the deprecated command, which still works there.
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

export function ScanResult({ result, lit }: { result: ScanResultData | null; lit: boolean }) {
  const [copied, setCopied] = useState(false);

  if (!result) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Nothing decoded yet. Open the camera and hold a QR code in view, or decode one from an image.
      </p>
    );
  }

  const url = isUrl(result.text);

  const copy = async () => {
    try {
      await writeClipboard(result.text);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error(`Could not copy: ${error instanceof Error ? error.message : "the browser refused"}. Select the text and copy it by hand.`);
    }
  };

  const share = url ? (
    <ShareButton url={result.text} title="QR code link" text={`Scanned with ${identity.name}`} label="Share" variant="outline" />
  ) : (
    <ShareButton
      label="Share"
      variant="outline"
      title="Scanned QR text"
      text={`Scanned with ${identity.name}`}
      filename="scanned-text.png"
      cacheKey={result.text}
      makeImage={() =>
        renderShareCard({
          title: "Scanned text",
          subtitle: `From ${identity.name}`,
          lines: cardLines(result.text),
          format: "square",
        })
      }
    />
  );

  return (
    <div
      data-scan-result=""
      className={cn(
        "rounded-lg border bg-card px-4 py-4 transition-shadow",
        lit ? "border-primary ring-2 ring-primary/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {lit ? "Scan captured" : result.source === "camera" ? "Last scan — camera" : "Last scan — image"}
        </p>
        <time dateTime={new Date(result.at).toISOString()} className="text-xs text-muted-foreground">
          {new Date(result.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </time>
      </div>

      <p className="mt-2 select-all break-words text-base leading-relaxed">
        {url ? (
          <a
            href={result.text}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-2"
          >
            {result.text}
          </a>
        ) : (
          result.text
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <Button type="button" onClick={() => void copy()} aria-label={`Copy scanned text${url ? " (the link itself, not the page it opens)" : ""}`}>
          {copied ? "Copied" : "Copy"}
        </Button>
        {share}
      </div>
    </div>
  );
}