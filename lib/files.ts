"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Files the visitor brings: checking them, reading them, shrinking photos and handing a file back.
 *
 * The things that go wrong are the same every time, and none of them throw where you would look:
 *
 * 1. A file is judged by its name. `photo.png` that is really a HEIC, or a `.json` that is a PDF,
 *    passes an extension check and fails later, somewhere less obvious. `acceptsFile` is the cheap
 *    first gate; `loadImage` and `readAsJson` are the real one, because they fail when the content
 *    does, with a message fit for the screen.
 * 2. A phone photo is 4000 pixels and 5 MB. Stored or drawn as it is, it fills the browser's quota
 *    and stalls the page. `resizeImage` brings it down before anything keeps it.
 * 3. Object URLs leak. `useObjectUrl` creates one for a Blob and revokes it when the Blob changes
 *    or the component goes away.
 *
 * Client-only, hence the directive: call these from event handlers and effects, not during render.
 */

/** A file that was offered and turned away, with the reason to show beside its name. */
export type RejectedFile = { file: File; reason: string };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Whether a file matches an `accept` string, the same one an `<input type="file">` takes:
 * `"image/*"`, `"application/json,.json"`, `".csv,.txt"`. An empty `accept`, or the any-type wildcard, takes anything.
 *
 * Matches the MIME type or the extension, as the browser's own chooser does. That is a filter, not
 * proof of what is inside: open the file (`loadImage`, `readAsJson`) before trusting it.
 */
export function acceptsFile(file: File, accept: string | undefined): boolean {
  const rules = (accept ?? "").split(",").map((rule) => rule.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  const type = file.type.toLowerCase();
  const extension = extensionOf(file.name);
  return rules.some((rule) => {
    if (rule === "*/*" || rule === "*") return true;
    if (rule.startsWith(".")) return extension === rule;
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/** `1536` → `"1.5 KB"`. For limits and file lists the visitor reads. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The file as text (UTF-8). */
export function readAsText(file: Blob): Promise<string> {
  return file.text();
}

/**
 * The file parsed as JSON, or a thrown `Error` whose message names the file and what is wrong with
 * it, ready to show. Pass `check` to say what shape you expect; a file that parses but does not
 * match is refused the same way, so nothing downstream receives the wrong thing.
 */
export async function readAsJson<T = unknown>(file: File, check?: (value: unknown) => value is T): Promise<T> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error(`${file.name} could not be read.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? ` (${error.message})` : "";
    throw new Error(`${file.name} is not valid JSON${detail}.`);
  }
  if (check && !check(value)) throw new Error(`${file.name} is JSON, but not in the shape this app expects.`);
  return value as T;
}

/** The file as a `data:` URL. Only for small files: the string is a third larger than the bytes. */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

function nameOf(file: Blob): string {
  return file instanceof File ? file.name : "The file";
}

/**
 * Decode an image file, or reject with a message saying it is not one this browser can open.
 *
 * This is the real check for an image: a file with an image name or type that will not decode is
 * caught here. The returned element is for measuring and drawing on a canvas; to *show* a file, use
 * `useObjectUrl`.
 */
export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${nameOf(file)} is not an image this browser can open.`));
    };
    image.src = url;
  });
}

export type ResizeOptions = {
  /** The longest side, in pixels, after resizing. Default 1600. Never enlarges. */
  maxEdge?: number;
  /** Output type. Default `image/png` for a PNG (keeps transparency), `image/jpeg` otherwise. */
  type?: string;
  /** 0–1, for JPEG and WebP. Default 0.85. */
  quality?: number;
};

/**
 * Decode for drawing, trying each way this browser may support before giving up.
 *
 * Older Safari and Firefox throw a TypeError for the `imageOrientation` option itself, so its
 * failure says nothing about the file: try again without it, then with an `<img>`, which applies
 * EXIF orientation by itself in current browsers. Only when all of them fail is the file refused,
 * with `loadImage`'s message.
 */
async function decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* the option may be what failed: try without it */
    }
    try {
      return await createImageBitmap(file);
    } catch {
      /* some formats decode only through <img>: try that last */
    }
  }
  return loadImage(file);
}

/**
 * A smaller copy of an image file, re-encoded, as a Blob.
 *
 * The browser applies the photo's EXIF orientation while decoding, so the result is upright; the
 * re-encoded file carries no EXIF at all, which also drops the camera's location data. A JPEG has
 * no transparency, so transparent areas are filled white. Rejects, like `loadImage`, for a file that
 * will not decode.
 */
export async function resizeImage(file: Blob, options: ResizeOptions = {}): Promise<Blob> {
  const { maxEdge = 1600, quality = 0.85 } = options;
  const type = options.type ?? (file.type === "image/png" ? "image/png" : "image/jpeg");

  const source = await decodeImage(file);

  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize images.");
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (!(source instanceof HTMLImageElement)) source.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image could not be resized."))), type, quality);
  });
}

// One URL per Blob, shared by every mounted component showing it, and revoked when the last one lets
// go. URLs are created and revoked only in the subscription (an effect), never during render, so a
// render React throws away or runs twice in development creates nothing that could leak.
const objectUrls = new Map<Blob, { url: string; holders: number }>();

function holdObjectUrl(blob: Blob): () => void {
  let entry = objectUrls.get(blob);
  if (!entry) {
    entry = { url: URL.createObjectURL(blob), holders: 0 };
    objectUrls.set(blob, entry);
  }
  entry.holders += 1;
  const held = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.holders -= 1;
    if (held.holders > 0 || objectUrls.get(blob) !== held) return;
    objectUrls.delete(blob);
    URL.revokeObjectURL(held.url);
  };
}

/**
 * An object URL for a Blob, for `<img src>`, `<audio src>` or a download link; null for null.
 *
 * Null on the first render, then the URL once the component has mounted. Revoked when the Blob
 * changes and when the component unmounts, so nothing leaks however often the visitor picks a new
 * file. Never call `URL.createObjectURL` in render yourself.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!blob) return () => undefined;
      const release = holdObjectUrl(blob);
      onChange(); // the URL exists now: render again to show it
      return release;
    },
    [blob],
  );
  return useSyncExternalStore(
    subscribe,
    () => (blob ? objectUrls.get(blob)?.url ?? null : null),
    () => null,
  );
}

/**
 * Hand a Blob to the visitor as a downloaded file: an edited photo, a recording, a generated CSV.
 * Call it from a click handler.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked later rather than now: some browsers start the download after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
