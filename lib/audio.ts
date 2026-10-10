"use client";

import { useSyncExternalStore } from "react";

/**
 * One AudioContext for the whole app, and the three things that make sound silently fail.
 *
 * 1. Browsers start an AudioContext `suspended` until the page has had a user gesture, so sound
 *    scheduled on load plays nothing and throws nothing. `unlockAudio()` is called from a click or
 *    key handler and resumes it there.
 * 2. A context suspended by the browser (a hidden tab, an iOS interruption) stays suspended. This
 *    module suspends it when the tab is hidden and resumes it when the tab comes back, and reports
 *    `suspended` honestly if the browser refuses, so the UI can offer a button. A timer or alarm
 *    that must sound from another tab calls `setAudioBackgroundPolicy("keep")` instead.
 * 3. Microphone access can be refused, absent, or impossible on an insecure origin. Each is a
 *    different message, and none of them is an exception the UI should swallow.
 *
 * Client-only, hence the directive: import it from client components and call it from event
 * handlers and effects, not during render.
 */

export type AudioStatus =
  /** No context yet: nothing has asked for sound. */
  | "idle"
  /** Playing, or ready to play. */
  | "running"
  /** Exists but silent: waiting for a gesture, or the tab is hidden. Offer a visible way to resume. */
  | "suspended"
  /** This browser has no Web Audio. */
  | "unsupported"
  | "closed";

let context: AudioContext | null = null;
let master: GainNode | null = null;
let resumeWhenVisible = false;
let unsupported = false;
let backgroundPolicy: AudioBackgroundPolicy = "suspend";
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The current status, without creating anything. */
export function audioStatus(): AudioStatus {
  if (unsupported) return "unsupported";
  if (!context) return "idle";
  // Safari reports "interrupted" after a call or Siri; it behaves as suspended.
  const state = context.state as AudioContextState | "interrupted";
  if (state === "running") return "running";
  if (state === "closed") return "closed";
  return "suspended";
}

export function subscribeAudio(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The audio status as React state: re-renders when it changes. `"idle"` during server render. */
export function useAudioStatus(): AudioStatus {
  return useSyncExternalStore(subscribeAudio, audioStatus, () => "idle");
}

/**
 * What happens to sound while the tab is hidden. `"suspend"` (the default) stops the context, which
 * saves battery for toys and games. `"keep"` leaves it running, so a timer's chime plays while the
 * visitor is in another tab.
 */
export type AudioBackgroundPolicy = "suspend" | "keep";

/**
 * Choose what happens to sound while the tab is hidden; call it once, e.g. in a timer's Start
 * handler. `"keep"` does not unlock anything: the context still needs `unlockAudio()` from a gesture
 * first, or it stays suspended in the background too.
 */
export function setAudioBackgroundPolicy(policy: AudioBackgroundPolicy): void {
  backgroundPolicy = policy;
  if (policy === "keep" && resumeWhenVisible && context && context.state !== "closed") {
    // This module suspended it for a hidden tab moments ago; undo that rather than wait for the tab.
    resumeWhenVisible = false;
    void context.resume().then(notify, notify);
  }
}

/** The current background policy: `"suspend"` unless `setAudioBackgroundPolicy("keep")` was called. */
export function audioBackgroundPolicy(): AudioBackgroundPolicy {
  return backgroundPolicy;
}

function onVisibility() {
  if (!context || context.state === "closed") return;
  if (document.visibilityState === "hidden") {
    if (backgroundPolicy === "suspend" && context.state === "running") {
      resumeWhenVisible = true;
      void context.suspend().then(notify, notify);
    }
  } else if (resumeWhenVisible) {
    resumeWhenVisible = false;
    // May stay suspended if the browser wants a fresh gesture; the status says so and the UI offers one.
    void context.resume().then(notify, notify);
  }
}

/**
 * The shared context, created on first use, or null where there is none (server render, no Web
 * Audio). Creating it does not make it audible: call `unlockAudio()` from a gesture.
 */
export function getAudioContext(): AudioContext | null {
  if (context) return context;
  if (typeof window === "undefined") return null;
  const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) {
    unsupported = true;
    notify();
    return null;
  }
  context = new Constructor();
  master = context.createGain();
  master.connect(context.destination);
  context.addEventListener("statechange", notify);
  document.addEventListener("visibilitychange", onVisibility);
  notify();
  return context;
}

/** Every sound connects here rather than to `destination`, so one gain mutes or sets volume for all. */
export function getMasterGain(): GainNode | null {
  getAudioContext();
  return master;
}

/**
 * Create (if needed) and resume the context. Call it **inside** a click, pointer or key handler —
 * the only place a browser allows it — before scheduling the first sound.
 */
export async function unlockAudio(): Promise<AudioStatus> {
  const ctx = getAudioContext();
  if (!ctx) return audioStatus();
  resumeWhenVisible = false;
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      /* reported through the status */
    }
  }
  notify();
  return audioStatus();
}

/** Mute or unmute everything, smoothly enough not to click. */
export function setMuted(muted: boolean): void {
  const ctx = getAudioContext();
  if (!ctx || !master) return;
  master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.015);
}

export type ChimeOptions = {
  /** The first tone in Hz; the second is a fifth above it. Default 880. */
  frequency?: number;
  /** The length of each tone in milliseconds. Default 180. */
  durationMs?: number;
  /** Peak loudness of each tone, 0 to 1, before the master gain. Default 0.25. */
  gain?: number;
};

/**
 * Two short rising tones through the master gain, with ramped envelopes so they do not click: the
 * end of a timer, an alarm, a "done". Returns false, silently, when sound is not running yet (no
 * gesture has called `unlockAudio()`, or the tab was hidden under the `"suspend"` policy), so the
 * app should say the same thing in text.
 */
export function playChime(options: ChimeOptions = {}): boolean {
  const ctx = getAudioContext();
  const out = master;
  if (!ctx || !out || ctx.state !== "running") return false;
  const finite = (value: number | undefined, fallback: number) => (value !== undefined && Number.isFinite(value) ? value : fallback);
  const frequency = Math.min(8000, Math.max(40, finite(options.frequency, 880)));
  const duration = Math.max(0.04, finite(options.durationMs, 180) / 1000);
  // Exponential ramps cannot reach or start from 0, so the floor is a hair above silence.
  const peak = Math.min(1, Math.max(0.0002, finite(options.gain, 0.25)));
  const start = ctx.currentTime + 0.01;
  const tones = [
    { at: start, frequency },
    { at: start + duration + 0.05, frequency: frequency * 1.5 },
  ];
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tone.frequency, tone.at);
    envelope.gain.setValueAtTime(0.0001, tone.at);
    envelope.gain.exponentialRampToValueAtTime(peak, tone.at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, tone.at + duration);
    osc.connect(envelope);
    envelope.connect(out);
    osc.start(tone.at);
    osc.stop(tone.at + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      envelope.disconnect();
    };
  }
  return true;
}

export type MicrophoneResult =
  | { status: "granted"; stream: MediaStream }
  | {
    /**
     * `denied` — the visitor or a policy refused. `unavailable` — no microphone, or this browser
     * cannot capture. `insecure` — the page is not on HTTPS or localhost. `in-use` — another app
     * holds the device. `error` — anything else.
     */
    status: "denied" | "unavailable" | "insecure" | "in-use" | "error";
    message: string;
  };

/**
 * Ask for the microphone. Call it from a button the visitor pressed, never on load: a prompt that
 * appears unasked is one people refuse, and some browsers refuse it for them.
 *
 * Never throws. Every outcome comes back as a status with a message fit to show on screen.
 */
export async function requestMicrophone(constraints: MediaTrackConstraints | boolean = true): Promise<MicrophoneResult> {
  if (typeof window === "undefined") return { status: "unavailable", message: "The microphone is only available in the browser." };
  if (!window.isSecureContext) {
    return { status: "insecure", message: "The microphone needs a secure (https) page." };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { status: "unavailable", message: "This browser cannot use a microphone." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    return { status: "granted", stream };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return { status: "denied", message: "Microphone access was blocked. Allow it in the browser's site settings, then try again." };
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return { status: "unavailable", message: "No microphone was found." };
    }
    if (name === "NotReadableError" || name === "AbortError") {
      return { status: "in-use", message: "The microphone is in use by another app, or could not be started." };
    }
    return { status: "error", message: error instanceof Error ? error.message : "The microphone could not be started." };
  }
}

/** Stop every track, which is what turns the browser's recording indicator off. */
export function stopStream(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** The recording formats tried, best first: Opus in WebM (Chromium, Firefox), then MP4 (Safari). */
export const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/mp4"] as const;

/**
 * The first recording format this browser supports, or `""` to let `MediaRecorder` choose its own.
 * `isSupported` defaults to `MediaRecorder.isTypeSupported`.
 */
export function pickRecordingType(isSupported?: (type: string) => boolean): string {
  const check =
    isSupported ??
    (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function"
      ? (type: string) => MediaRecorder.isTypeSupported(type)
      : null);
  if (!check) return "";
  return RECORDING_TYPES.find((type) => check(type)) ?? "";
}

const NOT_RECORDABLE = "The recording could not start. The microphone may have been turned off or unplugged: ask for it again.";

export type Recording = {
  /** The recorded audio. Empty (size 0) if recording never started. */
  blob: Blob;
  /** From start() to stop(), in milliseconds. */
  durationMs: number;
  /** What the browser actually produced, e.g. `audio/webm;codecs=opus` or `audio/mp4`. Keep it with the Blob. */
  mimeType: string;
};

export type MicrophoneRecorder = {
  /**
   * Start recording. A second call is a no-op. Throws only if this browser cannot record, or the
   * stream can no longer be recorded (its microphone was turned off or unplugged), with a message
   * fit for the screen; `stop()` still resolves afterwards, with an empty recording.
   */
  start(): void;
  /** Stop and get the recording. Every call (and `maxMs`) resolves with the same recording, always. */
  stop(): Promise<Recording>;
};

/**
 * Record a microphone stream from `requestMicrophone()`. Nothing happens until `start()`.
 *
 * `maxMs` stops the recording automatically; `onStop` hears about every stop, including that one,
 * so the UI can leave its "recording" state. The stream keeps running after the recording stops:
 * call `stopStream(stream)` when the microphone is no longer needed.
 */
export function recordMicrophone(
  stream: MediaStream,
  options: { maxMs?: number; onStop?: (recording: Recording) => void } = {},
): MicrophoneRecorder {
  const preferred = pickRecordingType();
  const chunks: Blob[] = [];
  let recorder: MediaRecorder | null = null;
  let finished = false;
  let stopping = false;
  let startedAt = 0;
  let stoppedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveRecording: (recording: Recording) => void = () => undefined;
  const recording = new Promise<Recording>((resolve) => {
    resolveRecording = resolve;
  });

  const finish = (mimeType: string) => {
    if (finished) return;
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
    const type = mimeType || chunks[0]?.type || "";
    const result: Recording = {
      blob: new Blob(chunks, type ? { type } : undefined),
      durationMs: startedAt ? Math.max(0, Math.round((stoppedAt || performance.now()) - startedAt)) : 0,
      mimeType: type,
    };
    resolveRecording(result);
    options.onStop?.(result);
  };

  const stop = (): Promise<Recording> => {
    if (finished || stopping) return recording;
    const active = recorder;
    if (!active) {
      finish(preferred);
      return recording;
    }
    stopping = true;
    stoppedAt = performance.now();
    const fallback = () => finish(active.mimeType || preferred);
    if (active.state === "inactive") {
      // It stopped by itself (the track ended) and its `stop` event is on the way; finish anyway if
      // that event never comes, so this promise always settles.
      setTimeout(fallback, 1000);
      return recording;
    }
    try {
      // The data arrives in `dataavailable` just before `stop` fires; `finish` runs there.
      active.stop();
    } catch {
      fallback();
    }
    return recording;
  };

  const start = (): void => {
    if (recorder || finished) return;
    if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record audio.");
    let active: MediaRecorder;
    try {
      active = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    } catch {
      try {
        active = new MediaRecorder(stream);
      } catch {
        throw new Error(NOT_RECORDABLE);
      }
    }
    active.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    active.addEventListener("stop", () => finish(active.mimeType || preferred));
    active.addEventListener("error", () => {
      if (active.state !== "inactive") active.stop();
      else finish(active.mimeType || preferred);
    });
    try {
      active.start();
    } catch {
      // Nothing was recorded and nothing will be: leave no half-started state behind.
      throw new Error(NOT_RECORDABLE);
    }
    recorder = active;
    startedAt = performance.now();
    if (options.maxMs && options.maxMs > 0) timer = setTimeout(() => void stop(), options.maxMs);
  };

  return { start, stop };
}

/**
 * Measure a microphone stream's loudness for a level meter. `onLevel` receives the RMS level, 0
 * (silence) to about 1 (very loud), roughly twenty times a second. Speech sits around 0.02–0.2, so
 * scale it up for display (e.g. `Math.min(1, rms * 4)`).
 *
 * Returns the function that stops measuring; call it when the meter goes away. It does not stop
 * the stream. Nothing reaches the speakers. Call `unlockAudio()` in the same click that asked for
 * the microphone, or the level stays at 0.
 */
export function micLevel(stream: MediaStream, onLevel: (rms: number) => void): () => void {
  const ctx = getAudioContext();
  if (!ctx || typeof requestAnimationFrame === "undefined") return () => undefined;
  if (ctx.state !== "running") void unlockAudio();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let raf = 0;
  let last = 0;
  let stopped = false;

  const tick = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (now - last < 50) return;
    last = now;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const centred = (sample - 128) / 128;
      sum += centred * centred;
    }
    onLevel(Math.sqrt(sum / samples.length));
  };
  raf = requestAnimationFrame(tick);

  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    source.disconnect();
    analyser.disconnect();
  };
}
