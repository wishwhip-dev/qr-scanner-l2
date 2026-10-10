# Sound and the microphone

`@/lib/audio` holds the app's one `AudioContext` and the handling that makes sound reliable. Web
Audio is built into the browser, so there is nothing to install. Use this module rather than
`new AudioContext()` in a component, and rather than an audio library: sound that fails in a
browser fails **silently**, and every one of the ways it fails is handled here.

The failure this exists for: an app whose sound worked in every automated check and that its
owner still could not hear. Sound scheduled before a user gesture plays nothing and throws
nothing, so nothing but a person listening notices.

## The rules

1. **Nothing is audible until the visitor does something.** Browsers start an `AudioContext`
   suspended. Call `unlockAudio()` *inside* a click, pointer or key handler — a "Start", "Play" or
   "Sound on" button — before scheduling the first sound. Calling it on load or in an effect does
   nothing.
2. **The sound state is visible.** Show whether sound is on, and when `useAudioStatus()` is
   `"suspended"` show a button that calls `unlockAudio()` ("Tap to enable sound"). Never leave the
   visitor to guess why it is quiet. `"unsupported"` gets a sentence saying sound is not available
   in this browser.
3. **One context, one master gain.** Connect every sound to `getMasterGain()`, not to
   `ctx.destination`, so mute and volume are one control. Never create a context per sound — browsers
   cap how many exist and the extra ones fail.
4. **Hidden tab, quiet tab.** The module suspends the context when the tab is hidden and resumes it
   when the tab returns. If the browser refuses to resume without a new gesture, the status goes
   `"suspended"` and rule 2 covers it. A timer or alarm opts out: see "Timers and alarms".
5. **Schedule on the audio clock.** Use `ctx.currentTime` for timing, never `setTimeout` alone:
   timers drift by tens of milliseconds and a rhythm audibly wobbles.

## A sound engine

Generate sounds with oscillators and gain envelopes where you can — there are no audio files to
fetch, and nothing to fail to load.

```ts
// lib/sound.ts — this app's sounds
import { getAudioContext, getMasterGain } from "@/lib/audio";

export function blip(frequency = 660, duration = 0.12) {
  const ctx = getAudioContext();
  const out = getMasterGain();
  if (!ctx || !out || ctx.state !== "running") return;   // not unlocked yet: stay silent, do not throw
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);   // ramps, not jumps: a jump clicks
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + duration + 0.02);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}
```

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setMuted, unlockAudio, useAudioStatus } from "@/lib/audio";
import { blip } from "@/lib/sound";

export function SoundToggle() {
  const status = useAudioStatus();
  const [muted, setMutedLabel] = useState(false);
  const audible = status === "running" && !muted;
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={async () => {
        if (audible) { setMuted(true); setMutedLabel(true); return; }
        setMuted(false);
        setMutedLabel(false);
        if ((await unlockAudio()) === "running") blip();   // audible confirmation it worked
      }}>
        {audible ? "Mute sound" : "Turn sound on"}
      </Button>
      {status === "suspended" && <span className="text-sm text-muted-foreground">Sound is paused. Press the button to resume.</span>}
      {status === "unsupported" && <span className="text-sm text-muted-foreground">Sound is not available in this browser.</span>}
    </div>
  );
}
```

`setMuted` only sets the gain, so the label keeps its own state.

**A sequencer or metronome** schedules ahead on the audio clock: every 25 ms, a timer schedules any
notes falling in the next 100 ms at their exact `ctx.currentTime`. The timer can be late; the notes
are not.

```ts
let next = ctx.currentTime + 0.05;
const timer = window.setInterval(() => {
  while (next < ctx.currentTime + 0.1) { scheduleNote(next); next += 60 / bpm; }
}, 25);
// stop: clearInterval(timer)
```

**Audio files**, when a sound must be recorded: put them in `public/`, `fetch` and
`decodeAudioData` once after unlock, keep the `AudioBuffer`, and play each hit with a fresh
`AudioBufferSourceNode` (they are one-shot by design).

**Visualising sound**: an `AnalyserNode` between your source and the master gain, read with
`getByteFrequencyData` inside a `CanvasStage` `frame` — never through React state.

## Timers and alarms

A pomodoro, a kitchen timer or an alarm has to chime while the visitor is in another tab, which
rule 4 prevents by default. Opt out for this app, and keep the gesture rule:

1. **Call `setAudioBackgroundPolicy("keep")` once**, in the timer's Start handler. The context then
   keeps running while the tab is hidden. The default, `"suspend"`, is right for toys and games: it
   saves battery.
2. **Call `unlockAudio()` in the same click**, before any other `await`. `"keep"` keeps sound alive;
   it does not allow it. A context nobody unlocked from a gesture stays suspended in the background
   too, and the chime plays nothing.
3. **Chime with `playChime()`** at the end: two short tones through the master gain, with no
   clicks. Options: `{ frequency, durationMs, gain }` (defaults 880 Hz, 180 ms, 0.25). It returns
   `false` and stays silent when sound is not running.
4. **Show the state as text**: "Chime on" when `useAudioStatus()` is `"running"`, otherwise
   "Chime off" with the button that unlocks it. The finished timer also says "Time's up" on the page,
   so a silent chime never hides the result.
5. **Count down from an end time** (`Date.now()`), not by counting ticks: browsers slow timers in
   hidden tabs, so ticks are lost and the chime can come late.

```tsx
const status = useAudioStatus();
const [endsAt, setEndsAt] = useState<number | null>(null);
const [done, setDone] = useState(false);

useEffect(() => {
  if (endsAt === null) return;
  const timer = setInterval(() => {
    if (Date.now() < endsAt) return;
    clearInterval(timer);
    setEndsAt(null);
    setDone(true);
    playChime();
  }, 250);
  return () => clearInterval(timer);
}, [endsAt]);

<Button onClick={async () => {
  setAudioBackgroundPolicy("keep");
  await unlockAudio();
  setDone(false);
  setEndsAt(Date.now() + 25 * 60_000);
}}>Start</Button>
<p>{status === "running" ? "Chime on" : "Chime off: press Start to turn it on"}</p>
{done && <p>Time's up</p>}
```

Be honest about the limits: a browser may still throttle or mute a background tab. iOS Safari
silences a page's audio once its tab has been in the background for a while, and desktop browsers
can delay timers in a tab hidden for minutes. The chime is a convenience; the text on the page is
the result.

## The microphone

`requestMicrophone()` never throws. It returns `{ status: "granted", stream }` or one of
`denied`, `unavailable`, `insecure`, `in-use`, `error`, each with a `message` written for the
screen.

```tsx
const [mic, setMic] = useState<{ state: "off" } | { state: "on"; stream: MediaStream } | { state: "refused"; message: string }>({ state: "off" });

<Button onClick={async () => {
  await unlockAudio();
  const result = await requestMicrophone();
  if (result.status === "granted") setMic({ state: "on", stream: result.stream });
  else setMic({ state: "refused", message: result.message });
}}>Use microphone</Button>

{mic.state === "refused" && <Alert><AlertTitle>No microphone</AlertTitle><AlertDescription>{mic.message}</AlertDescription></Alert>}
```

- **Ask from a button, never on load.** A prompt nobody asked for is one people refuse.
- **A refusal is a state the app shows, not an error it hides.** Show the message, keep the rest of
  the app usable, and keep the button so they can try again after changing the setting. If the app
  can work without the microphone (a file, a demo signal, a keyboard), offer that beside it.
- **Design the refusal anyway.** The verification browser has a fake microphone and camera and grants access, so the granted path is the one it exercises; real devices refuse, so the denied and unavailable states must render clearly and throw nothing.
- **Stop the stream when done** with `stopStream(stream)`, and on unmount. A live track keeps the
  browser's recording indicator on.
- Connect a stream with `ctx.createMediaStreamSource(stream)`. Do not connect the microphone to the
  speakers unless the product is a monitor: it feeds back.

## Recording

Ask for the microphone as above (`unlockAudio()` then `requestMicrophone()`, from a button), then:

- **Meter** with `micLevel(stream, onLevel)`: it calls `onLevel(rms)` about twenty times a second
  (0 is silence, speech is roughly 0.02–0.2) and returns the function that stops measuring.
- **Record** with `recordMicrophone(stream, { maxMs, onStop })`: `start()` begins, `stop()`
  resolves with `{ blob, durationMs, mimeType }`. It picks `audio/webm;codecs=opus`, then
  `audio/mp4` (Safari), then the browser's default, so keep `mimeType` with the Blob. `maxMs` stops
  it on its own and `onStop` hears every stop, so the UI leaves its recording state either way.
  `start()` throws, with a message to show, when the browser cannot record or the microphone has
  gone away since it was granted; `stop()` resolves whatever happened.
- **The length is text on the page** while recording and after: "Recording 7 s", "Recorded 12.4 s".
- **Stop the stream** (`stopStream`) when the microphone is no longer needed and on unmount; stopping
  the recorder does not turn the browser's recording indicator off.

```tsx
const [level, setLevel] = useState(0);
const [recorder, setRecorder] = useState<MicrophoneRecorder | null>(null);
const [seconds, setSeconds] = useState(0);
const [clip, setClip] = useState<Recording | null>(null);
const [problem, setProblem] = useState<string | null>(null);

useEffect(() => (stream ? micLevel(stream, setLevel) : undefined), [stream]);
useEffect(() => {
  if (!recorder) return;
  const started = Date.now();
  const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
  return () => clearInterval(timer);
}, [recorder]);

<meter min={0} max={1} value={Math.min(1, level * 4)} aria-label="Microphone level" />
{recorder ? (
  <Button onClick={() => void recorder.stop()}>Stop recording</Button>
) : (
  <Button disabled={!stream} onClick={() => {
    if (!stream) return;
    const next = recordMicrophone(stream, { maxMs: 60_000, onStop: (done) => { setClip(done); setRecorder(null); } });
    try { next.start(); } catch (error) { setProblem((error as Error).message); return; }
    setSeconds(0);
    setRecorder(next);
  }}>Start recording</Button>
)}
<p>{recorder ? `Recording ${seconds} s` : clip ? `Recorded ${(clip.durationMs / 1000).toFixed(1)} s` : "Not recording"}</p>
{problem && <p className="text-sm text-destructive">{problem}</p>}
{clipUrl && <audio controls src={clipUrl} />}
```

**Play it back** from an object URL: if `lib/files.ts` exists,
`const clipUrl = useObjectUrl(clip?.blob ?? null)` makes it and revokes it when the clip changes;
otherwise `URL.createObjectURL(blob)` and `URL.revokeObjectURL` the old one when it is replaced.
**Save it** as the Blob itself in IndexedDB (Dexie stores Blobs; see `docs/storage.md` if the
project has it) with its `mimeType` and `durationMs`, and keep it out of a JSON export, where a
Blob becomes `{}`. Where `docs/sync.md` exists, keep recordings in a media-only table referenced by
id so the rest can move.

## Client only

Everything here runs in the browser: call it from client components, in event handlers and
effects, never during render.
