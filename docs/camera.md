# The camera

`@/lib/camera` asks for the camera and turns every way it fails into a status and a sentence;
`@/components/camera-view` is a ready preview with its controls. Both use browser APIs only, so
there is nothing to install. Use them rather than calling `getUserMedia` in a component.

```tsx
import { CameraView } from "@/components/camera-view";

<CameraView facing="environment" onPhoto={(photo) => savePhoto(photo)} />
```

`CameraView` shows an "Open camera" button, then the live preview, "Take photo", "Switch camera"
(only when the device has more than one) and "Stop camera", with the current state as a line of
text under the video.

## The rules

1. **Ask from a button, never on load.** Call `requestCamera()` inside a click handler. A prompt
   nobody asked for is one people refuse, and iOS Safari will not start a camera without a gesture.
2. **Every state is text outside the video.** "Camera on", "Camera blocked: …", "No camera found",
   "Camera is in use by another app": `requestCamera()` never throws and returns
   `{ status, stream?, message }` with `status` one of `granted`, `denied`, `unavailable`,
   `insecure`, `in-use`, `error` and a `message` you can show as it is. A black rectangle is not a
   state. Keep the button after a refusal so they can try again, and keep the rest of the app usable.
3. **Stop the tracks.** A live stream keeps the camera light on. Call `stopStream(stream)` when the
   visitor is done, on unmount and when the tab is hidden; `CameraView` does all three and offers
   "Resume camera" when the tab comes back. Use `stopStream` from `@/lib/camera` for camera
   streams (`@/lib/audio` has its own for the microphone; the two are independent).
4. **iOS Safari needs `playsInline` and `muted`** on the `<video>`, or it opens the camera full
   screen or shows nothing. `attachStream(video, stream)` sets both and waits until it plays.
5. **Mirror the selfie preview, not the photo.** People expect the front camera to behave like a
   mirror; `CameraView` flips the preview for `facing="user"`. `capturePhoto` returns the true
   orientation (text reads correctly) unless you pass `mirror: true`.

## Your own camera UI

```tsx
const result = await requestCamera({ facing: "user" });   // in a click handler
if (result.status !== "granted") { setMessage(result.message); return; }
await attachStream(videoRef.current!, result.stream);      // <video autoPlay playsInline muted>
const photo = await capturePhoto(videoRef.current!, { maxEdge: 1280, type: "image/jpeg", quality: 0.9 });
stopStream(result.stream);
```

`requestCamera({ facing })` tries the exact camera, then the preferred one, then any camera, so a
laptop webcam (which reports no facing) still opens. `listCameras()` lists cameras (labels appear
only after access is granted); `requestCamera({ deviceId })` opens a specific one.

## Keeping photos

`capturePhoto` resolves with a `Blob` (JPEG at 0.9 by default; `maxEdge` scales it down). Store the
Blob itself in IndexedDB — Dexie stores Blobs (see `docs/storage.md` if the project has it) — and
keep it out of a JSON export, where a Blob becomes `{}`. A small image (thumbnails, a few tens of KB) can be stored as a
data URL instead. If `lib/files.ts` exists, it has the helpers: `readAsDataUrl`, `resizeImage`,
`useObjectUrl` to display a Blob, `saveBlob` to hand one to the visitor. Where `docs/sync.md`
exists, keep photos in a media-only table referenced by id so the rest can move.

## QR codes and barcodes

`BarcodeDetector` is missing from most browsers (Linux Chromium, Firefox, desktop Safari). For QR
or barcode scanning, install `jsqr` ad hoc (`npm install jsqr`) and say so in the plan: draw the
video frame to a canvas every few hundred milliseconds, pass `getImageData` to `jsQR`, and show
what was read as text. A "Scan" flow keeps the camera open until a code is found, showing
"Scanning…" as text meanwhile, rather than judging a single frame.

## Video clips

Record with `MediaRecorder` on the stream (ask with `requestCamera({ audio: true })` for sound),
preferring `video/webm` and falling back to `video/mp4` with `MediaRecorder.isTypeSupported`. The
output differs by browser (Safari records MP4), so keep the Blob's own `type`, show the recording
length as text, and stop the recorder before stopping the tracks.

## Client only

Everything here runs in the browser: call it from client components, in event handlers and
effects, never during render.
