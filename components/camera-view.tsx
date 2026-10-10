"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  attachStream,
  capturePhoto,
  listCameras,
  requestCamera,
  stopStream,
  type CameraFacing,
  type CameraStatus,
  type PhotoOptions,
} from "@/lib/camera";

/**
 * A camera preview with its controls and its state in words.
 *
 * Nothing starts on load: the camera opens from the "Open camera" button. While it is on, the
 * preview is mirrored for the selfie camera (as people expect), "Take photo" hands the current frame
 * to `onPhoto` as a Blob, and "Stop camera" turns the camera light off. The camera also stops when
 * the component unmounts and when the tab is hidden, and offers to resume when the visitor is back.
 * Every state — off, starting, on, paused, blocked, missing, in use — is a sentence beside the video,
 * never only a black box.
 */

type CameraViewProps = {
  /** Which camera to open first. Default `"user"` (the selfie camera). */
  facing?: CameraFacing;
  /** Receives each photo taken. Store the Blob (IndexedDB keeps Blobs) or turn it into a data URL. */
  onPhoto?: (photo: Blob) => void;
  /** Passed to `capturePhoto`: type, quality, maxEdge. */
  photoOptions?: PhotoOptions;
  className?: string;
};

type ViewState =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream; mirrored: boolean }
  | { kind: "paused" }
  | { kind: "failed"; status: Exclude<CameraStatus, "granted">; message: string };

function describe(state: ViewState): string {
  switch (state.kind) {
    case "off":
      return "Camera off";
    case "starting":
      return "Starting camera…";
    case "on":
      return "Camera on";
    case "paused":
      return "Camera paused while the tab was hidden";
    case "failed":
      return state.message;
  }
}

/** The selfie camera is mirrored; a camera that does not report its facing keeps the requested one. */
function isMirrored(stream: MediaStream, requested: CameraFacing): boolean {
  const reported = stream.getVideoTracks()[0]?.getSettings().facingMode;
  if (reported === "user") return true;
  if (reported === "environment") return false;
  return requested === "user";
}

export function CameraView({ facing = "user", onPhoto, photoOptions, className }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const aliveRef = useRef(true);
  const [state, setState] = useState<ViewState>({ kind: "off" });
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const stream = state.kind === "on" ? state.stream : null;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Everything tied to one live stream: showing it, stopping it when the tab is hidden or the camera
  // disappears, and stopping it on the way out. The cleanup runs when the stream is replaced, when
  // the state leaves "on" (Stop camera, a hidden tab) and on unmount, so tracks are never left live.
  useEffect(() => {
    if (!stream) return;
    const video = videoRef.current;
    if (video) void attachStream(video, stream);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setState({ kind: "paused" });
    };
    const onEnded = () =>
      setState({ kind: "failed", status: "error", message: "Camera stopped: it was disconnected or access was withdrawn. Open it again to continue." });
    const track = stream.getVideoTracks()[0];
    document.addEventListener("visibilitychange", onVisibility);
    track?.addEventListener("ended", onEnded);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      track?.removeEventListener("ended", onEnded);
      if (video && video.srcObject === stream) video.srcObject = null;
      stopStream(stream);
    };
  }, [stream]);

  async function open(deviceId?: string) {
    setState({ kind: "starting" });
    setNote("");
    const result = await requestCamera(deviceId ? { deviceId } : { facing });
    if (!aliveRef.current) {
      stopStream(result.stream);
      return;
    }
    if (result.status !== "granted") {
      setState({ kind: "failed", status: result.status, message: result.message });
      return;
    }
    setState({ kind: "on", stream: result.stream, mirrored: isMirrored(result.stream, facing) });
    const found = await listCameras();
    if (aliveRef.current) setCameras(found);
  }

  async function switchCamera() {
    if (state.kind !== "on" || cameras.length < 2) return;
    const current = state.stream.getVideoTracks()[0]?.getSettings().deviceId;
    const index = cameras.findIndex((camera) => camera.deviceId === current);
    const next = cameras[(index + 1) % cameras.length];
    // Phones cannot run two cameras at once: release this one before asking for the next.
    stopStream(state.stream);
    await open(next.deviceId);
  }

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || state.kind !== "on") return;
    setBusy(true);
    try {
      const photo = await capturePhoto(video, photoOptions);
      onPhoto?.(photo);
      setNote(`Photo taken at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "The photo could not be taken.");
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }

  const on = state.kind === "on";
  const failed = state.kind === "failed";
  const showVideo = on || state.kind === "starting";

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg border bg-muted",
          failed ? "border-destructive/60" : "border-border",
          !showVideo && "hidden",
        )}
        style={{ aspectRatio: "4 / 3" }}
      >
        <video
          ref={videoRef}
          data-camera-view
          autoPlay
          playsInline
          muted
          aria-label="Camera preview"
          className="absolute inset-0 h-full w-full object-cover"
          style={on && state.mirrored ? { transform: "scaleX(-1)" } : undefined}
        />
      </div>

      <p role="status" aria-live="polite" className={cn("text-sm", failed ? "text-destructive" : "text-muted-foreground")}>
        {describe(state)}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {on ? (
          <>
            <Button type="button" onClick={() => void takePhoto()} disabled={busy}>
              Take photo
            </Button>
            {cameras.length > 1 && (
              <Button type="button" variant="outline" onClick={() => void switchCamera()}>
                Switch camera
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setState({ kind: "off" })}>
              Stop camera
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => void open()} disabled={state.kind === "starting"}>
            {state.kind === "paused" ? "Resume camera" : "Open camera"}
          </Button>
        )}
      </div>

      {note && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}
