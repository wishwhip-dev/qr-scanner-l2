"use client";

/**
 * The camera, with every way it fails turned into a status and a sentence.
 *
 * 1. Ask from a button the visitor pressed, never on load. A prompt nobody asked for is one people
 *    refuse, and iOS Safari will not start a camera without a gesture at all.
 * 2. `requestCamera` never throws. Blocked, missing, in use by another app, an insecure page: each
 *    comes back as a status with a `message` written for the screen, the same vocabulary as
 *    `requestMicrophone` in `lib/audio`.
 * 3. A live stream keeps the camera light on. `stopStream` turns it off; call it when the visitor is
 *    done, when the component unmounts and when the tab is hidden.
 *
 * Client-only, hence the directive: call these from event handlers and effects, not during render.
 */

export type CameraFacing = "user" | "environment";

export type CameraStatus = "granted" | "denied" | "unavailable" | "insecure" | "in-use" | "error";

export type CameraResult =
  | { status: "granted"; stream: MediaStream; message: string }
  | {
    /**
     * `denied` — the visitor or a policy refused. `unavailable` — no camera, or this browser cannot
     * capture. `insecure` — the page is not on HTTPS or localhost. `in-use` — another app holds the
     * camera. `error` — anything else.
     */
    status: Exclude<CameraStatus, "granted">;
    stream?: undefined;
    message: string;
  };

export type CameraOptions = {
  /** `"user"` is the selfie camera, `"environment"` the one on the back of a phone. */
  facing?: CameraFacing;
  /** A specific camera from `listCameras()`. Wins over `facing`. */
  deviceId?: string;
  /** Also capture the microphone, for a video clip with sound. Default false. */
  audio?: boolean;
};

function errorName(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  return "";
}

/** The constraints to try, most specific first. A laptop webcam reports no facing at all, so an exact facing falls back to a preferred one, then to any camera. */
function videoAttempts(options: CameraOptions): MediaTrackConstraints[] {
  const size: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (options.deviceId) return [{ ...size, deviceId: { exact: options.deviceId } }, size];
  if (options.facing) return [{ ...size, facingMode: { exact: options.facing } }, { ...size, facingMode: options.facing }, size];
  return [size];
}

/**
 * Ask for the camera. Call it from a click handler, never on load.
 *
 * Never throws. Every outcome comes back as a status with a message fit to show on screen as it is.
 */
export async function requestCamera(options: CameraOptions = {}): Promise<CameraResult> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { status: "unavailable", message: "No camera found: the camera only works in the browser." };
  }
  if (!window.isSecureContext) {
    return { status: "insecure", message: "Camera unavailable: it needs a secure (https) page." };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { status: "unavailable", message: "No camera found: this browser cannot use a camera." };
  }
  const attempts = videoAttempts(options);
  let lastError: unknown = null;
  for (const video of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: options.audio === true });
      return { status: "granted", stream, message: "Camera on" };
    } catch (error) {
      lastError = error;
      const name = errorName(error);
      // Only a constraint this device cannot meet is worth retrying with a looser one.
      if (name !== "OverconstrainedError" && name !== "NotFoundError") break;
    }
  }
  const name = errorName(lastError);
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { status: "denied", message: "Camera blocked: allow camera access in the browser's site settings, then try again." };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { status: "unavailable", message: "No camera found. Connect one, then try again." };
  }
  if (name === "NotReadableError") {
    return { status: "in-use", message: "Camera is in use by another app. Close that app, then try again." };
  }
  if (name === "AbortError") {
    return { status: "in-use", message: "Camera is in use by another app, or could not be started. Try again." };
  }
  const detail = lastError instanceof Error && lastError.message ? lastError.message : "something went wrong.";
  return { status: "error", message: `Camera failed to start: ${detail}` };
}

/**
 * Show a stream in a `<video>` and wait until it is playing (at most `timeoutMs`, default 3 s).
 * Sets `muted` and `playsInline`, without which iOS Safari opens the camera full screen or not at all.
 * Resolves with the video; a browser that refuses to autoplay still resolves at the cap.
 */
export async function attachStream(video: HTMLVideoElement, stream: MediaStream, timeoutMs = 3000): Promise<HTMLVideoElement> {
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  if (video.srcObject !== stream) video.srcObject = stream;
  if (video.videoWidth > 0 && !video.paused) return video;
  await new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener("playing", done);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    video.addEventListener("playing", done);
    // A refused or interrupted play() is not an error here: the timeout resolves and the caller
    // still has the video. `playing` is the signal, not this promise.
    video.play().catch(() => undefined);
  });
  return video;
}

export type PhotoOptions = {
  /** Default `"image/jpeg"`. `"image/png"` is lossless and several times larger. */
  type?: string;
  /** 0 to 1, for JPEG and WebP. Default 0.9. */
  quality?: number;
  /** Scale down so the longer side is at most this many pixels. Default: the camera's full size. */
  maxEdge?: number;
  /** Flip horizontally, to match a mirrored selfie preview. Default false: text in the photo reads correctly. */
  mirror?: boolean;
};

/**
 * The current frame of a playing video as an image Blob. Rejects, with a message fit for the screen,
 * when the camera has no picture yet or the image cannot be encoded.
 */
export function capturePhoto(video: HTMLVideoElement, options: PhotoOptions = {}): Promise<Blob> {
  const { type = "image/jpeg", quality = 0.9, maxEdge, mirror = false } = options;
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) {
    return Promise.reject(new Error("The camera has no picture yet. Wait a moment, then try again."));
  }
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight)) : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser could not draw the photo."));
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The photo could not be saved as an image."))),
      type,
      quality,
    );
  });
}

/** Stop every track, which is what turns the camera light off. Safe to call twice or with nothing. */
export function stopStream(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/**
 * The cameras this device has. Labels are empty until the visitor has granted access once, so call
 * it after `requestCamera` succeeds. Never throws; an empty list means none could be listed.
 */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "videoinput");
  } catch {
    return [];
  }
}

/** The other side of a phone: `"user"` becomes `"environment"` and back. */
export function switchFacing(facing: CameraFacing): CameraFacing {
  return facing === "user" ? "environment" : "user";
}
