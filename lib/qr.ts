"use client";

/**
 * QR decoding with jsQR, over two sources:
 *
 * - a live camera frame (`decodeFromVideo`): the video's current picture is drawn to an
 *   offscreen canvas, downscaled to keep the per-frame cost low, and handed to jsQR as pixel
 *   data. The caller polls this every few hundred milliseconds while the preview is open.
 * - a still image (`decodeImageFile`): a photo or screenshot of a QR code, decoded once.
 *
 * Both return the decoded text, or null when no code is in view — a frame without a code is a
 * normal answer, not an error. A frame that cannot be read at all (no canvas, a dead video)
 * throws, so the caller can say so instead of scanning silently forever.
 */

import jsQR from "jsqr";

/** Longest side a frame is scaled down to before decoding. jsQR is happiest under ~1000px. */
const MAX_DECODE_EDGE = 800;

/** One shared canvas, reused frame after frame so scanning does not allocate per tick. */
let scratch: HTMLCanvasElement | null = null;

function scratchContext(width: number, height: number): CanvasRenderingContext2D {
  if (!scratch) scratch = document.createElement("canvas");
  const canvas = scratch;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot read camera frames.");
  return ctx;
}

/** Decode pixel data already drawn on a canvas. Returns the text, or null when no code is there. */
function decodeCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): string | null {
  const image = ctx.getImageData(0, 0, width, height);
  const code = jsQR(image.data, width, height, { inversionAttempts: "dontInvert" });
  // A second pass with inverted colours: some codes read only one way on dark backgrounds.
  const fallback = code ?? jsQR(image.data, width, height, { inversionAttempts: "invertFirst" });
  const text = fallback?.data?.trim();
  return text ? text : null;
}

/** Draw a source at a downscaled size, then decode it. Shared by the video and image paths. */
function decodeScaled(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
): string | null {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = scratchContext(width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return decodeCanvas(ctx, width, height);
}

/**
 * The current frame of a playing `<video>` (the camera preview), decoded. Returns null when the
 * video has no picture yet or no code is in view. Throws when frames cannot be read at all.
 */
export function decodeFromVideo(video: HTMLVideoElement): string | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  return decodeScaled(video, width, height, MAX_DECODE_EDGE);
}

/**
 * A still image (a photo or screenshot of a QR code), decoded once. Returns null when the image
 * opened but holds no code; throws when the image itself cannot be opened.
 *
 * A photo can hold a small code: the first pass scales it down as the camera frames are, and a
 * miss retries at double the resolution before giving up.
 */
export async function decodeImageFile(file: Blob): Promise<string | null> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      const first = decodeScaled(bitmap, bitmap.width, bitmap.height, MAX_DECODE_EDGE);
      if (first || Math.max(bitmap.width, bitmap.height) <= MAX_DECODE_EDGE) return first;
      return decodeScaled(bitmap, bitmap.width, bitmap.height, MAX_DECODE_EDGE * 2);
    } finally {
      bitmap.close();
    }
  }
  // Older browsers without createImageBitmap: decode through an <img>.
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This image could not be opened."));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) return null;
    const first = decodeScaled(image, image.naturalWidth, image.naturalHeight, MAX_DECODE_EDGE);
    if (first || Math.max(image.naturalWidth, image.naturalHeight) <= MAX_DECODE_EDGE) return first;
    return decodeScaled(image, image.naturalWidth, image.naturalHeight, MAX_DECODE_EDGE * 2);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** True when the decoded text is a web address, and should be shown as a link. */
export function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}