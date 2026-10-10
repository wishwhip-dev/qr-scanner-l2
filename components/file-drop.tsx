"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { acceptsFile, formatBytes, type RejectedFile } from "@/lib/files";
import { cn } from "@/lib/utils";

/**
 * The one way files come into this app: a button that opens the chooser, a zone they can be dropped
 * on, and (with `paste`) the clipboard. Every route lands in `onFiles`, already checked.
 *
 * What it gets right so the page does not have to:
 *
 * - The drag highlight does not flicker. `dragleave` fires every time the pointer crosses a child
 *   element, so the zone counts enters and leaves instead of trusting one event.
 * - A file dropped beside the zone does not make the browser navigate away to it.
 * - Rejected files are listed with the reason, as text, until the next choice — never dropped
 *   silently. `onFiles` receives them too.
 * - Choosing the same file twice in a row still fires.
 * - The button is a real button: focusable, labelled, and opened with Enter or Space. The file input
 *   behind it is hidden from sight and from screen readers, so there is one control, not two.
 * - A paste into a text field stays there, even when the clipboard also holds a picture.
 *
 * The label says what happens — "Choose photo", "Add files", "Load JSON". Never "Import", "Delete"
 * or another word for an action that replaces or removes data: this control only brings content in.
 *
 * `accept` and `maxBytes` check the type and size. That is a filter, not proof: open an image with
 * `loadImage` (or `resizeImage`) and JSON with `readAsJson` before keeping it, and show their error.
 */
export type FileDropProps = {
  /** Same syntax as the input's `accept`: `"image/*"`, `"application/json,.json"`. Default: anything. */
  accept?: string;
  multiple?: boolean;
  /** Largest file accepted, in bytes. Larger files are rejected with the limit in the reason. */
  maxBytes?: number;
  /** The button's text. Default "Choose files" (or "Choose file" without `multiple`). */
  label?: string;
  /** Also take files pasted anywhere on the page (a screenshot, a copied image) while mounted. */
  paste?: boolean;
  disabled?: boolean;
  /** Called with what was accepted and what was not, every time files arrive by any route. */
  onFiles: (files: File[], rejected: RejectedFile[]) => void;
  /** Shown inside the zone, under the button. Default: a line saying files can be dropped here. */
  children?: ReactNode;
  className?: string;
};

function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** A text field or rich-text editor, where a paste belongs to whatever is being typed. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

export function FileDrop({ accept, multiple = false, maxBytes, label, paste = false, disabled = false, onFiles, children, className }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const hintId = useId();

  const take = (offered: File[]) => {
    if (disabled || !offered.length) return;
    const accepted: File[] = [];
    const refused: RejectedFile[] = [];
    for (const file of offered) {
      if (!acceptsFile(file, accept)) {
        refused.push({ file, reason: `not a supported type${accept ? ` (accepts ${accept.split(",").map((rule) => rule.trim()).join(", ")})` : ""}` });
      } else if (maxBytes !== undefined && file.size > maxBytes) {
        refused.push({ file, reason: `too large: ${formatBytes(file.size)}, the limit is ${formatBytes(maxBytes)}` });
      } else if (file.size === 0) {
        refused.push({ file, reason: "the file is empty" });
      } else if (!multiple && accepted.length) {
        refused.push({ file, reason: "only one file at a time" });
      } else {
        accepted.push(file);
      }
    }
    setRejected(refused);
    onFiles(accepted, refused);
  };

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return; // plain text: leave it to whatever has focus
    // Cells copied from a spreadsheet or a word processor carry text and a picture of themselves.
    // Pasted into a field, the visitor means the text.
    if (isEditable(event.target) && Array.from(event.clipboardData?.types ?? []).includes("text/plain")) return;
    event.preventDefault();
    take(files);
  });

  useEffect(() => {
    if (!paste) return;
    const listener = (event: ClipboardEvent) => onPaste(event);
    document.addEventListener("paste", listener);
    return () => document.removeEventListener("paste", listener);
  }, [paste]);

  // A file dropped a few pixels outside the zone would otherwise replace the page with the file.
  useEffect(() => {
    const block = (event: globalThis.DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const buttonLabel = label ?? (multiple ? "Choose files" : "Choose file");

  return (
    <div
      data-file-drop=""
      data-dragging={dragging ? "" : undefined}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation(); // a zone inside another zone handles its own drop, once
        depth.current = 0;
        setDragging(false);
        take(Array.from(event.dataTransfer?.files ?? []));
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-6 text-center transition-colors",
        dragging && "border-primary bg-accent",
        disabled && "opacity-50",
        className,
      )}
    >
      {/* Out of sight and out of the accessibility tree: the button below is the one control. */}
      <input
        ref={inputRef}
        type="file"
        hidden
        aria-hidden="true"
        aria-label={buttonLabel}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = ""; // so choosing the same file again still fires
          take(files);
        }}
      />
      <Button type="button" variant="outline" disabled={disabled} aria-describedby={hintId} onClick={() => inputRef.current?.click()}>
        {buttonLabel}
      </Button>
      <div id={hintId} className="text-sm text-muted-foreground">
        {dragging
          ? "Drop to add"
          : children ?? `or drop ${multiple ? "files" : "a file"} here${paste ? ", or paste" : ""}${maxBytes !== undefined ? ` (up to ${formatBytes(maxBytes)})` : ""}`}
      </div>
      {/* Always mounted, empty when nothing was turned away, so screen readers announce what is added to it. */}
      <ul aria-live="polite" className={cn("w-full text-left text-sm text-destructive", rejected.length === 0 && "-mt-2")}>
        {rejected.map(({ file, reason }, index) => (
          <li key={`${file.name}-${index}`}>
            Not added: {file.name} — {reason}.
          </li>
        ))}
      </ul>
    </div>
  );
}
