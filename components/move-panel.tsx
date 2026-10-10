"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DatabaseHandle, TableMap } from "@/lib/storage";
import { applyMove, codeFromHash, formatCode, MOVE_COPY, moveIn, moveOut, problemText, status, type MoveInResult, type MoveProblem } from "@/lib/sync";

/**
 * "Move to another device": the whole flow in one panel, for the app's settings screen.
 *
 * - "Move to another device" snapshots the database, encrypts it and shows a one-time code (and a
 *   link carrying it). Nothing on this device changes.
 * - "I have a code" takes that code on the other device, fetches and checks what it carries, and
 *   asks before replacing anything: the confirm button is labelled with "Import", like every
 *   control that replaces the app's whole data set, and is disabled when nothing would be imported.
 *   Tables that stay where they are (they hold photos) are named on both devices.
 * - Opened from a link with `#move=<code>`, it offers to check that code, and takes the code out of
 *   the address bar so it is not left in the history. Once checked or cancelled, the link's code is
 *   forgotten for the rest of the page, so a used code is never offered again.
 *
 * Every sentence is in `MOVE_COPY` (lib/sync.ts). Place it once:
 *   <MovePanel database={database} />   with `database` from "@/lib/db".
 */
export type MovePanelProps<Tables extends TableMap> = {
  /** The app's database, the `database` export of lib/db.ts. */
  database: DatabaseHandle<Tables>;
  className?: string;
};

type View = "idle" | "out" | "in" | "confirm";
type Moved = Extract<MoveInResult, { ok: true }>;

const noSubscription = () => () => {};

// Read once per page load, so taking the code out of the address bar does not take it off screen.
// Emptied once the code is checked or cancelled, so a remounted panel does not offer it again.
let linkedCode: string | undefined;
function readLinkedCode(): string {
  if (linkedCode === undefined) linkedCode = codeFromHash(location.hash) ?? "";
  return linkedCode;
}

function forgetLinkedCode(): void {
  linkedCode = "";
}

function readStatus(): string {
  return status().reason ?? "ok";
}

export function MovePanel<Tables extends TableMap>({ database, className }: MovePanelProps<Tables>) {
  // Both read the browser, so the server render and hydration see the neutral value first.
  const linked = useSyncExternalStore(noSubscription, readLinkedCode, () => "");
  const state = useSyncExternalStore(noSubscription, readStatus, () => "pending");
  const [view, setView] = useState<View>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [out, setOut] = useState<{ code: string; link: string; leftOut: string[] } | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [linkHandled, setLinkHandled] = useState(false);
  const [moved, setMoved] = useState<Moved | null>(null);
  const inputId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!codeFromHash(location.hash)) return;
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  }, []);

  const works = state === "ok" || state === "no-url";
  const notice = state === "no-url" ? MOVE_COPY.notHere : state === "no-crypto" ? MOVE_COPY.problems["no-crypto"] : state === "paused" ? MOVE_COPY.problems.paused : null;
  const fromLink = Boolean(linked) && !linkHandled && view === "idle";
  const shown: View = fromLink ? "in" : view;
  const value = typed ?? (fromLink ? formatCode(linked) : "");
  const nothingToImport = moved !== null && Object.keys(moved.tables).length === 0;

  const fail = (reason: MoveProblem, lost?: boolean) => setMessage(problemText(reason, lost));

  async function startMoveOut() {
    setBusy(true);
    setMessage(null);
    setCopied(null);
    const result = await moveOut(database);
    setBusy(false);
    if (!result.ok) return fail(result.reason);
    setOut({ code: result.code, link: result.link, leftOut: result.leftOut });
    setView("out");
  }

  async function checkCode() {
    const code = value;
    forgetLinkedCode();
    setBusy(true);
    setMessage(null);
    setLinkHandled(true);
    setTyped(code);
    setView("in");
    const result = await moveIn(database, code);
    setBusy(false);
    if (!result.ok) return fail(result.reason, result.lost);
    setMoved(result);
    setView("confirm");
  }

  async function replace() {
    if (!moved) return;
    setBusy(true);
    setMessage(null);
    try {
      await applyMove(database, moved.data);
      setMoved(null);
      setTyped(null);
      setView("idle");
      setMessage(MOVE_COPY.done);
    } catch {
      // The copy was taken from WishWhip when the code was checked: hand it back, so checking the
      // same code again works.
      const kept = await moved.putBack();
      setMoved(null);
      setView("in");
      setMessage(kept ? MOVE_COPY.applyFailed : MOVE_COPY.applyFailedLost);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    forgetLinkedCode();
    setMoved(null);
    setTyped(null);
    setView("idle");
    setMessage(MOVE_COPY.cancelled);
  }

  function copy(text: string, which: "code" | "link") {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) return setMessage(MOVE_COPY.copyFailed);
    clipboard.writeText(text).then(() => setCopied(which), () => setMessage(MOVE_COPY.copyFailed));
  }

  return (
    <section aria-labelledby={`${messageId}-heading`} className={["space-y-3 rounded-lg border p-4", className].filter(Boolean).join(" ")}>
      <div className="space-y-1">
        <h2 id={`${messageId}-heading`} className="text-base font-semibold">{MOVE_COPY.heading}</h2>
        <p className="text-sm text-muted-foreground">{MOVE_COPY.intro}</p>
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      </div>

      {shown === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={startMoveOut} disabled={!works || busy}>
            {busy ? MOVE_COPY.moving : MOVE_COPY.moveOut}
          </Button>
          <Button type="button" variant="outline" onClick={() => { setMessage(null); setView("in"); }} disabled={!works || busy}>
            {MOVE_COPY.haveCode}
          </Button>
        </div>
      ) : null}

      {shown === "out" && out ? (
        <div className="space-y-2">
          <p className="text-sm">{MOVE_COPY.codeIntro}</p>
          <p className="select-all font-mono text-lg font-semibold tracking-wider" aria-label={MOVE_COPY.codeLabel}>{out.code}</p>
          <p className="break-all text-xs text-muted-foreground">{out.link}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => copy(out.code, "code")}>{MOVE_COPY.copyCode}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => copy(out.link, "link")}>{MOVE_COPY.copyLink}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setView("idle"); setOut(null); setCopied(null); }}>{MOVE_COPY.finish}</Button>
          </div>
          {copied ? <p className="text-xs text-muted-foreground" role="status">{MOVE_COPY.copied}</p> : null}
          <p className="text-xs text-muted-foreground">{MOVE_COPY.codeRules}</p>
          {out.leftOut.length ? (
            <>
              <p className="text-xs text-muted-foreground">{MOVE_COPY.leftHere(out.leftOut)}</p>
              <p className="text-xs text-muted-foreground">{MOVE_COPY.leftOut}</p>
            </>
          ) : null}
        </div>
      ) : null}

      {shown === "in" ? (
        <form
          className="space-y-2"
          onSubmit={(event) => { event.preventDefault(); void checkCode(); }}
        >
          {fromLink ? <p className="text-sm">{MOVE_COPY.fromLink}</p> : null}
          <label htmlFor={inputId} className="text-sm font-medium">{MOVE_COPY.codeLabel}</label>
          <Input
            id={inputId}
            value={value}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={MOVE_COPY.codePlaceholder}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            className="font-mono tracking-wider"
            aria-describedby={messageId}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!works || busy || !value.trim()}>
              {busy ? MOVE_COPY.checking : MOVE_COPY.check}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { forgetLinkedCode(); setLinkHandled(true); setTyped(null); setView("idle"); setMessage(null); }} disabled={busy}>
              {MOVE_COPY.cancel}
            </Button>
          </div>
        </form>
      ) : null}

      {shown === "confirm" && moved ? (
        <div role="group" aria-labelledby={`${messageId}-confirm`} className="space-y-2 rounded-md border border-destructive/40 p-3">
          <p id={`${messageId}-confirm`} className="text-sm font-semibold">{MOVE_COPY.confirmTitle}</p>
          <p className="text-sm">{MOVE_COPY.confirmBody}</p>
          <ul className="list-disc pl-5 text-sm">
            {Object.entries(moved.tables).map(([table, count]) => <li key={table}>{MOVE_COPY.rows(table, count)}</li>)}
          </ul>
          {nothingToImport ? <p className="text-sm">{MOVE_COPY.nothingToImport}</p> : null}
          {moved.leftOut.length ? (
            <>
              <p className="text-xs text-muted-foreground">{MOVE_COPY.leftHere(moved.leftOut)}</p>
              <p className="text-xs text-muted-foreground">{MOVE_COPY.leftOut}</p>
            </>
          ) : null}
          <p className="text-sm font-medium">{MOVE_COPY.replaceWarning}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" onClick={replace} disabled={busy || nothingToImport}>
              {busy ? MOVE_COPY.replacing : MOVE_COPY.confirm}
            </Button>
            <Button type="button" variant="outline" onClick={cancel} disabled={busy}>{MOVE_COPY.cancel}</Button>
          </div>
        </div>
      ) : null}

      <p id={messageId} role="status" aria-live="polite" className="min-h-5 text-sm">{message}</p>
    </section>
  );
}
