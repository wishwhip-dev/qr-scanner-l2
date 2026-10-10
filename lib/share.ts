"use client";

/**
 * Sharing a result: a picture of it for Stories and chats, or the link to the app.
 *
 * The things that go wrong are the same every time:
 *
 * 1. Text drawn on a canvas does not wrap. A long title runs off the edge, and the card that gets
 *    posted is cut in half. `renderShareCard` wraps every line to the card's width (`wrapText`),
 *    caps how many lines each part may take and ends a cut line with "…".
 * 2. `navigator.share` is missing on most desktops, cannot take files in some browsers, and rejects
 *    when the visitor closes the sheet. `shareImage` and `shareLink` try the share sheet, fall back
 *    to saving the image or copying the link, and tell you which happened as a plain status. A
 *    closed sheet is `"cancelled"`, not a failure.
 * 3. A share sheet nobody asked for is refused, and most browsers will not open one without a click
 *    anyway. Call these from a click handler, never on load or on a timer.
 *
 * Client-only, hence the directive: call these from event handlers, not during render.
 */

/** `story` 1080×1920 (Stories, Reels, status updates), `square` 1080×1080 (feed posts, chats), `wide` 1200×630 (link-preview shape). */
export type ShareCardFormat = "story" | "square" | "wide";

export type ShareCardOptions = {
  /** The headline: the score, the result, the name of the thing made. Large and bold. */
  title: string;
  /** One sentence under the title. */
  subtitle?: string;
  /** Short facts, one per entry: "12 day streak", "Best time 0:42". Extra entries that do not fit are left off. */
  lines?: string[];
  /** The small line at the bottom. Default: this app's name. */
  footer?: string;
  /** The colour of the band and the marks, any CSS colour. Default: the page's theme colour. */
  accent?: string;
  /** Default `"square"`. */
  format?: ShareCardFormat;
};

/** `"refused"` only when `shareImage` was asked to report a refusal (`ifRefused: "report"`) rather than save. */
export type ShareImageResult = "shared" | "saved" | "cancelled" | "refused";

export type ShareLinkResult = "shared" | "copied" | "cancelled" | "unsupported";

/** Everything `shareImage` and `shareLink` can report, plus `"failed"` for an image that could not be made. */
export type ShareOutcome = ShareImageResult | ShareLinkResult | "failed";

/** The pixel size of each format. */
export const SHARE_CARD_SIZES: Readonly<Record<ShareCardFormat, { width: number; height: number }>> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  wide: { width: 1200, height: 630 },
};

/** `cardSize("story")` → `{ width: 1080, height: 1920 }`. Unknown formats get the square. */
export function cardSize(format: ShareCardFormat = "square"): { width: number; height: number } {
  return { ...(SHARE_CARD_SIZES[format] ?? SHARE_CARD_SIZES.square) };
}

/** The sentence to show for an outcome, as it is. Empty for nothing to say. */
export function shareStatusText(outcome: ShareOutcome | null | undefined): string {
  switch (outcome) {
    case "shared":
      return "Shared";
    case "saved":
      return "Image saved";
    case "copied":
      return "Link copied";
    case "cancelled":
      return "Not shared";
    case "refused":
      return "Tap again to share";
    case "unsupported":
      return "Sharing isn't available here";
    case "failed":
      return "The image could not be made";
    default:
      return "";
  }
}

const ELLIPSIS = "…";

/** Break one word that is wider than the line into pieces that fit, by character (emoji stay whole). */
function breakWord(word: string, measure: (text: string) => number, maxWidth: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const char of Array.from(word)) {
    if (piece && measure(piece + char) > maxWidth) {
      pieces.push(piece);
      piece = char;
    } else {
      piece += char;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Shorten a line until it and the ellipsis fit. */
function withEllipsis(line: string, measure: (text: string) => number, maxWidth: number): string {
  const chars = Array.from(line.trimEnd());
  while (chars.length && measure(chars.join("").trimEnd() + ELLIPSIS) > maxWidth) chars.pop();
  return chars.join("").trimEnd() + ELLIPSIS;
}

/**
 * Split text into lines no wider than `maxWidth`, as measured by `measure` (on a canvas,
 * `(t) => ctx.measureText(t).width` after setting `ctx.font`).
 *
 * Breaks between words, keeps explicit line breaks, and splits a word that is wider than a whole
 * line. With `maxLines`, the last kept line ends in "…" when text was left out.
 */
export function wrapText(text: string, measure: (text: string) => number, maxWidth: number, maxLines = Infinity): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (lines.length) lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word) <= maxWidth) {
        line = word;
      } else {
        const pieces = breakWord(word, measure, maxWidth);
        lines.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] ?? "";
      }
    }
    if (line) lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  kept[kept.length - 1] = withEllipsis(kept[kept.length - 1], measure, maxWidth);
  return kept;
}

type Layout = {
  padding: number;
  band: number;
  /** Space kept clear at the top and bottom, where an app's own buttons cover a Story. */
  safeTop: number;
  safeBottom: number;
  title: number;
  titleLines: number;
  subtitle: number;
  subtitleLines: number;
  line: number;
  footer: number;
  gap: number;
};

const LAYOUTS: Record<ShareCardFormat, Layout> = {
  story: { padding: 96, band: 28, safeTop: 250, safeBottom: 340, title: 112, titleLines: 5, subtitle: 56, subtitleLines: 3, line: 50, footer: 42, gap: 44 },
  square: { padding: 88, band: 24, safeTop: 0, safeBottom: 0, title: 92, titleLines: 4, subtitle: 46, subtitleLines: 3, line: 42, footer: 34, gap: 34 },
  wide: { padding: 72, band: 20, safeTop: 0, safeBottom: 0, title: 70, titleLines: 2, subtitle: 36, subtitleLines: 2, line: 32, footer: 28, gap: 22 },
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const BACKGROUND = "#0b0b0c";
const FOREGROUND = "#f5f5f4";
const MUTED = "#a8a29e";
const FALLBACK_ACCENT = "#6366f1";

function metaContent(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const content = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content?.trim();
  return content || undefined;
}

/** The app's name, as the page states it: its application-name, else its title. */
function appName(): string {
  return metaContent("application-name") ?? (typeof document === "undefined" ? "" : document.title.trim());
}

type Block = { lines: string[]; size: number; lineHeight: number; weight: number; color: string; bullet: boolean };

/**
 * Draw a share card and return it as a PNG Blob: the title large and bold, then the subtitle, then
 * each of `lines`, on a dark card with an accent band across the top and the footer at the bottom.
 * Everything wraps to the card's width; what still does not fit is left off from the end of
 * `lines`, then the title is cut with "…". Stories keep clear of the top and bottom, where Instagram
 * and the like put their own buttons.
 *
 * Rejects with a message fit for the screen when this browser cannot draw it.
 */
export async function renderShareCard(options: ShareCardOptions): Promise<Blob> {
  const format: ShareCardFormat = options.format && options.format in LAYOUTS ? options.format : "square";
  const layout = LAYOUTS[format];
  const { width, height } = cardSize(format);
  const accent = options.accent ?? metaContent("theme-color") ?? FALLBACK_ACCENT;
  const footer = (options.footer ?? appName()).trim();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw a share image.");

  const textWidth = width - layout.padding * 2;
  const bulletIndent = Math.round(layout.line * 0.9);
  const measureWith = (size: number, weight: number) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    return (text: string) => ctx.measureText(text).width;
  };
  const block = (text: string, size: number, weight: number, color: string, maxLines: number, bullet = false): Block => ({
    lines: wrapText(text, measureWith(size, weight), bullet ? textWidth - bulletIndent : textWidth, maxLines),
    size,
    lineHeight: Math.round(size * (size >= 60 ? 1.1 : 1.3)),
    weight,
    color,
    bullet,
  });
  const heightOf = (blocks: Block[]) =>
    blocks.reduce((sum, item, index) => sum + item.lines.length * item.lineHeight + (index ? (item.bullet && blocks[index - 1].bullet ? layout.gap / 2 : layout.gap) : 0), 0);

  // Where the content may go: below the band, above the footer.
  const footerTop = height - Math.max(layout.padding, layout.safeBottom) - layout.footer;
  const top = layout.band + Math.max(layout.padding, layout.safeTop);
  const available = footerTop - layout.gap * 1.5 - top;

  let titleLines = layout.titleLines;
  let facts = (options.lines ?? []).map((line) => line.trim()).filter(Boolean);
  const build = () => [
    block(options.title.trim() || " ", layout.title, 800, FOREGROUND, titleLines),
    ...(options.subtitle?.trim() ? [block(options.subtitle.trim(), layout.subtitle, 400, MUTED, layout.subtitleLines)] : []),
    ...facts.map((fact) => block(fact, layout.line, 500, FOREGROUND, 2, true)),
  ];
  let blocks = build();
  while (heightOf(blocks) > available && facts.length) {
    facts = facts.slice(0, -1);
    blocks = build();
  }
  while (heightOf(blocks) > available && titleLines > 1) {
    titleLines -= 1;
    blocks = build();
  }

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, width, layout.band);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let y = top + Math.max(0, Math.round((available - heightOf(blocks)) / 2));
  blocks.forEach((item, index) => {
    if (index) y += item.bullet && blocks[index - 1].bullet ? layout.gap / 2 : layout.gap;
    ctx.font = `${item.weight} ${item.size}px ${FONT}`;
    if (item.bullet) {
      const dot = Math.round(item.size * 0.32);
      ctx.fillStyle = accent;
      ctx.fillRect(layout.padding, y + Math.round((item.lineHeight - dot) / 2), dot, dot);
    }
    ctx.fillStyle = item.color;
    for (const line of item.lines) {
      ctx.fillText(line, layout.padding + (item.bullet ? bulletIndent : 0), y + Math.round((item.lineHeight - item.size) / 2));
      y += item.lineHeight;
    }
  });

  if (footer) {
    const mark = Math.round(layout.footer * 0.8);
    ctx.fillStyle = accent;
    ctx.fillRect(layout.padding, footerTop + Math.round((layout.footer - mark) / 2), mark, mark);
    const footerX = layout.padding + mark + Math.round(layout.footer * 0.5);
    const [footerLine] = wrapText(footer, measureWith(layout.footer, 600), width - layout.padding - footerX, 1);
    ctx.fillStyle = MUTED;
    ctx.fillText(footerLine ?? "", footerX, footerTop);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The share image could not be made."))), "image/png");
  });
}

function errorName(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  return "";
}

const EXTENSIONS: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };

/** `"result"` + PNG → `"result.png"`. Share targets and downloads both go by the extension. */
function withExtension(filename: string, type: string): string {
  const name = filename.trim() || "share";
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  return name + (EXTENSIONS[type] ?? ".png");
}

/** The same anchor trick as `saveBlob` in `lib/files`, kept here so this module stands alone. */
function saveImage(blob: Blob, filename: string): void {
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

/**
 * Offer an image through the device's share sheet (Instagram, Messages, WhatsApp…), or save it
 * where the sheet cannot take files. Call it from a click handler, with the Blob already made: the
 * sheet is opened before this function first waits, but Safari refuses one opened after anything
 * the click handler waited for (drawing the card included).
 *
 * Resolves `"shared"`, `"saved"` (downloaded instead) or `"cancelled"` (the visitor closed the
 * sheet: say nothing alarming, and do not save it anyway). When the browser refuses the sheet
 * (`NotAllowedError`: the click was too long ago) the image is saved, or, with
 * `ifRefused: "report"`, nothing happens and it resolves `"refused"` so the caller can ask for
 * another press. Never rejects.
 */
export async function shareImage(
  blob: Blob,
  options: { title: string; text?: string; filename: string; ifRefused?: "save" | "report" },
): Promise<ShareImageResult> {
  const type = blob.type || "image/png";
  const filename = withExtension(options.filename, type);
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (nav && typeof nav.share === "function" && typeof nav.canShare === "function" && typeof File === "function") {
    const file = new File([blob], filename, { type });
    const data: ShareData = { files: [file], title: options.title, ...(options.text ? { text: options.text } : {}) };
    let canShare = false;
    try {
      canShare = nav.canShare(data);
    } catch {
      canShare = false;
    }
    if (canShare) {
      try {
        await nav.share(data);
        return "shared";
      } catch (error) {
        if (errorName(error) === "AbortError") return "cancelled";
        if (errorName(error) === "NotAllowedError" && options.ifRefused === "report") return "refused";
        // NotAllowedError (the click was too long ago) or a target that refused the file: save instead.
      }
    }
  }
  saveImage(blob, filename);
  return "saved";
}

/**
 * Offer a link through the share sheet, or copy it where there is none. Call it from a click
 * handler.
 *
 * Resolves `"shared"`, `"copied"`, `"cancelled"` (the visitor closed the sheet) or `"unsupported"`
 * (no share sheet and no clipboard: show the link as text so it can be copied by hand). Never rejects.
 */
export async function shareLink(url: string, options: { title: string; text?: string }): Promise<ShareLinkResult> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (!nav) return "unsupported";
  const data: ShareData = { url, title: options.title, ...(options.text ? { text: options.text } : {}) };
  let canShare = typeof nav.share === "function";
  if (canShare && typeof nav.canShare === "function") {
    try {
      canShare = nav.canShare(data);
    } catch {
      canShare = false;
    }
  }
  if (canShare) {
    try {
      await nav.share(data);
      return "shared";
    } catch (error) {
      if (errorName(error) === "AbortError") return "cancelled";
      // Refused for another reason: fall through to the clipboard.
    }
  }
  if (nav.clipboard && typeof nav.clipboard.writeText === "function") {
    try {
      await nav.clipboard.writeText(url);
      return "copied";
    } catch {
      return "unsupported";
    }
  }
  return "unsupported";
}
