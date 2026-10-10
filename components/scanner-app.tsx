"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraView } from "@/components/camera-view";
import { FileDrop } from "@/components/file-drop";
import { ScanHistory } from "@/components/scan-history";
import { ScanResult, type ScanResultData } from "@/components/scan-result";
import { Button } from "@/components/ui/button";
import { database } from "@/lib/db";
import { addScan } from "@/lib/data/scans";
import { decodeFromVideo, decodeImageFile } from "@/lib/qr";
import { useDatabaseTransfer, useStorageStatus } from "@/lib/storage/react";
import { toast } from "sonner";

/**
 * The scanner: the camera preview with its QR read-out, the decode-from-image way in, the
 * decoded result, and the history.
 *
 * The camera opens only from its button (CameraView's "Scan QR code"). While the preview runs, a
 * timer reads a frame every 300 ms and decodes it; a code whose text equals the one just read is
 * ignored, so holding one code in view records it once, and scanning continues so the next code
 * needs no restart. The same decoded-text handling runs for an image file, and every new capture
 * — either way — is written to the database with the time it was read.
 */

export function ScannerApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastRead = useRef<string | null>(null);
  const [result, setResult] = useState<ScanResultData | null>(null);
  const [captureCount, setCaptureCount] = useState(0);
  const [scanProblem, setScanProblem] = useState<string | null>(null);
  const [imageState, setImageState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const storageStatus = useStorageStatus(database);
  const transfer = useDatabaseTransfer(database);

  const handleDecoded = useEffectEvent((text: string, source: "camera" | "image") => {
    if (source === "camera") {
      if (text === lastRead.current) return; // the same code is still in view
      lastRead.current = text;
    }
    setResult({ text, at: Date.now(), source });
    setCaptureCount((count) => count + 1);
    // A write that fails is told about; a write skipped by the data layer (the newest scan
    // already holds exactly this text) needs no word.
    void addScan(text).then(
      () => undefined,
      (error: unknown) =>
        toast.error(`Could not save the scan: ${error instanceof Error ? error.message : "unknown error"}.`),
    );
  });

  // The scan loop: one frame every 300 ms while the preview has a picture. The interval runs
  // whether or not the camera is open — with no video there is one cheap guard check per tick.
  useEffect(() => {
    const tick = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      try {
        const text = decodeFromVideo(video);
        setScanProblem((previous) => (previous === null ? previous : null));
        if (text) handleDecoded(text, "camera");
      } catch (error) {
        setScanProblem(error instanceof Error ? error.message : "Camera frames could not be read.");
      }
    };
    const timer = window.setInterval(tick, 300);
    return () => window.clearInterval(timer);
  }, []);

  const decodeFile = async (file: File) => {
    setImageState({ busy: true, message: null });
    try {
      const text = await decodeImageFile(file);
      if (text) {
        setImageState({ busy: false, message: null });
        handleDecoded(text, "image");
      } else {
        setImageState({ busy: false, message: "No QR code found in this image. Try a sharper shot, or one where the code fills more of the frame." });
      }
    } catch (error) {
      setImageState({ busy: false, message: error instanceof Error ? `The image could not be read: ${error.message}` : "The image could not be read." });
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 pb-16 pt-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Scan a QR code</h1>
        <p className="text-muted-foreground">
          Point the camera at a code, or decode one from a photo. What you scan is kept in a history on this device — nothing leaves it.
        </p>
      </header>

      {storageStatus === "memory" && (
        <p role="status" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          This browser will not keep your data: the history lasts only until this tab closes. Export it to a file below to keep a copy.
        </p>
      )}

      <section aria-labelledby="camera-heading" className="flex flex-col gap-3">
        <h2 id="camera-heading" className="text-lg font-semibold tracking-tight">
          Scan with the camera
        </h2>
        <CameraView facing="environment" openLabel="Scan QR code" hidePhotoButton videoRef={videoRef} />
        <p className="text-sm text-muted-foreground">
          Hold a QR code steady in view — about a second is enough. The preview keeps looking, so the next code needs no restart.
        </p>
        {scanProblem && <p className="text-sm text-destructive">{scanProblem}</p>}
      </section>

      <section aria-labelledby="image-heading" className="flex flex-col gap-3">
        <h2 id="image-heading" className="text-lg font-semibold tracking-tight">
          Decode from an image
        </h2>
        <FileDrop
          accept="image/*"
          label="Decode from image"
          paste
          maxBytes={20 * 1024 * 1024}
          disabled={imageState.busy}
          onFiles={(files) => {
            const file = files[0];
            if (file) void decodeFile(file);
          }}
        >
          or drop or paste a photo or screenshot of a QR code here
        </FileDrop>
        {imageState.message && <p className="text-sm text-destructive">{imageState.message}</p>}
      </section>

      <section aria-labelledby="result-heading" className="flex flex-col gap-3">
        <h2 id="result-heading" className="text-lg font-semibold tracking-tight">
          Decoded text
        </h2>
        <ScanResult result={result} captureCount={captureCount} />
      </section>

      <ScanHistory />

      <section aria-labelledby="data-heading" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="data-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Your data
        </h2>
        <p className="text-sm text-muted-foreground">
          The history lives in this browser on this device — nothing is sent anywhere. A file carries it to another device or keeps a copy.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Button type="button" variant="outline" onClick={() => void transfer.exportToFile()}>
            Export data
          </Button>
          <FileDrop
            accept="application/json,.json"
            label="Import data"
            className="flex-1"
            onFiles={(files) => {
              const file = files[0];
              if (file) void transfer.importFromFile(file, "replace");
            }}
          >
            or drop the export file here
          </FileDrop>
        </div>
        {transfer.state.kind === "error" && <p className="text-sm text-destructive">{transfer.state.message}</p>}
        {transfer.state.kind === "imported" && (
          <p className="text-sm text-muted-foreground">
            Imported {transfer.state.result.rows} {transfer.state.result.rows === 1 ? "row" : "rows"} — the history now shows what the file held.
          </p>
        )}
      </section>
    </div>
  );
}