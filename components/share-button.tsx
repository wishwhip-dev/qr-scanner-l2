"use client";

import { useCallback, useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { shareImage, shareLink, shareStatusText, type ShareOutcome } from "@/lib/share";
import { cn } from "@/lib/utils";

/**
 * The one share control: press it and the result goes to the device's share sheet, or is saved or
 * copied where there is none, with what happened written underneath.
 *
 * - With `makeImage`, the picture is made ahead of the press (usually `() => renderShareCard({...})`)
 *   and shared as a file; on a desktop without a share sheet the image is saved instead.
 * - Without it, it shares `url` (default: this page's address), or copies it.
 *
 * Why ahead: Safari (iPhone and iPad) refuses a share sheet opened after the click handler waited
 * for anything, drawing the card included. So the card is drawn shortly after the button appears
 * enabled, again when the pointer comes down on it or it takes focus if `makeImage` has changed,
 * and the press hands the finished file to the sheet straight away. If it is not finished yet, the
 * press finishes it and says "Tap again to share"; the next press shares that same picture. The
 * same happens if the browser refuses the sheet anyway. Nothing is saved instead.
 *
 * The card is re-made when `cacheKey` changes or, without one, when `makeImage` is a different
 * function. Pass a `cacheKey` that changes with what the card shows (the score, the result's id),
 * or wrap `makeImage` in `useCallback`; an inline function with no key is re-drawn after every
 * render, which costs time but never shares a stale picture.
 *
 * Every state is text under the button: "Preparing image…", "Tap again to share", "Shared",
 * "Image saved", "Link copied", "Not shared", "Sharing isn't available here" (with the link written
 * out to copy by hand). Nothing is shared until the visitor presses it.
 *
 * The label says what is shared — "Share result", "Share score", "Share card". Never a word for
 * removing or replacing data: this control only sends a copy out.
 */
export type ShareButtonProps = {
  /** Makes the image to share. Called before the press, so it must not depend on being clicked. Omit to share a link instead. */
  makeImage?: () => Promise<Blob>;
  /** Changes whenever the image would come out differently. Without it, a new `makeImage` function means a new image. */
  cacheKey?: string | number;
  /** The link to share when there is no `makeImage`. Default: the current page's address. */
  url?: string;
  /** Passed to the share sheet; some apps show it, some ignore it. */
  title: string;
  /** A sentence to go with it; some apps show it, some ignore it. */
  text?: string;
  /** The image's file name when saved or shared. Default "share.png". */
  filename?: string;
  /** The button's text. Default "Share result". */
  label?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  disabled?: boolean;
  /** Called once each press has an outcome ("refused" when the browser wants another press). */
  onShare?: (outcome: ShareOutcome) => void;
  className?: string;
};

/** One drawing of the card, kept until `makeImage` or `cacheKey` changes. */
type Prepared = {
  source: () => Promise<Blob>;
  key: string | number | undefined;
  promise: Promise<Blob>;
  state: "pending" | "ready" | "failed";
  blob?: Blob;
};

/** How long the button waits after appearing (or after `makeImage` changes) before drawing, so a burst of renders draws once. */
const PREPARE_DELAY_MS = 150;

export function ShareButton({ makeImage, cacheKey, url, title, text, filename = "share.png", label = "Share result", variant = "default", disabled = false, onShare, className }: ShareButtonProps) {
  const [phase, setPhase] = useState<"preparing" | "sharing" | null>(null);
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  // A finished picture waiting for the press that shares it ("Tap again to share").
  const [held, setHeld] = useState<{ blob: Blob; key: string | number | undefined } | null>(null);
  const prepared = useRef<Prepared | null>(null);
  const pressed = useRef<Prepared | null>(null);
  const statusId = useId();
  // A held picture from before `cacheKey` changed shows something else now.
  const waiting = held && held.key === cacheKey ? held.blob : null;

  /** The drawing for the current `makeImage` and `cacheKey`, started if there is none. */
  const prepare = useCallback((): Prepared | null => {
    if (!makeImage) return null;
    const existing = prepared.current;
    if (existing && existing.state !== "failed" && (cacheKey === undefined ? existing.source === makeImage : existing.key === cacheKey)) {
      return existing;
    }
    const promise = Promise.resolve().then(makeImage);
    const entry: Prepared = { source: makeImage, key: cacheKey, promise, state: "pending" };
    promise.then(
      (blob) => {
        entry.state = "ready";
        entry.blob = blob;
      },
      () => {
        entry.state = "failed";
      },
    );
    prepared.current = entry;
    return entry;
  }, [makeImage, cacheKey]);

  // Draw the card once the button is there to press: no share happens here, only the drawing.
  useEffect(() => {
    if (disabled || !makeImage) return;
    const timer = window.setTimeout(() => void prepare(), PREPARE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [disabled, makeImage, prepare]);

  const report = (result: ShareOutcome) => {
    setOutcome(result);
    onShare?.(result);
  };

  /** Hands a finished picture to the sheet. Called from the click with no wait before it. */
  const sendImage = async (blob: Blob) => {
    setPhase("sharing");
    const pending = shareImage(blob, { title, text, filename, ifRefused: "report" });
    try {
      const result = await pending;
      if (result === "refused") setHeld({ blob, key: cacheKey });
      report(result);
    } finally {
      setPhase(null);
    }
  };

  /** Finishes the picture this press is waiting on, then waits for another press. */
  const finishImage = async (entry: Prepared | null) => {
    if (!entry) return;
    setPhase("preparing");
    try {
      setHeld({ blob: await entry.promise, key: cacheKey });
    } catch (error) {
      setProblem(`The image could not be made${error instanceof Error && error.message ? `: ${error.message}` : "."}`);
      report("failed");
    } finally {
      setPhase(null);
    }
  };

  const sendLink = async () => {
    const link = url ?? window.location.href;
    setSharedUrl(link);
    setPhase("sharing");
    const pending = shareLink(link, { title, text });
    try {
      report(await pending);
    } finally {
      setPhase(null);
    }
  };

  const share = () => {
    setProblem(null);
    setOutcome(null);
    if (!makeImage) {
      void sendLink();
      return;
    }
    // What the pointer coming down asked for counts even if a render since has changed `makeImage`.
    const asked = pressed.current;
    pressed.current = null;
    if (waiting) {
      setHeld(null);
      void sendImage(waiting);
      return;
    }
    const current = prepare();
    const blob = asked?.state === "ready" ? asked.blob : current?.state === "ready" ? current.blob : undefined;
    if (blob) void sendImage(blob);
    else void finishImage(asked?.state === "pending" ? asked : current);
  };

  /** The pointer is coming down or the button has focus: make sure the picture is the current one. */
  const ready = () => {
    if (makeImage && !disabled && !waiting) pressed.current = prepare();
  };

  const status = phase === "preparing"
    ? "Preparing image…"
    : phase === "sharing"
      ? "Opening share options…"
      : problem ?? (waiting ? "Tap again to share" : shareStatusText(outcome));

  return (
    <div data-share-button="" className={cn("flex flex-col items-start gap-1.5", className)}>
      <Button
        type="button"
        variant={variant}
        disabled={disabled || phase !== null}
        aria-describedby={statusId}
        onPointerDown={ready}
        onFocus={ready}
        onClick={() => share()}
      >
        {label}
      </Button>
      {/* Always mounted, so screen readers announce each new state. */}
      <p id={statusId} aria-live="polite" className={cn("min-h-5 text-sm", problem ? "text-destructive" : "text-muted-foreground")}>
        {status}
        {phase === null && outcome === "unsupported" && sharedUrl ? (
          <>
            {". Copy this link: "}
            <span className="select-all break-all font-mono text-foreground">{sharedUrl}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
