# Files the visitor brings

`@/components/file-drop` is the one way files come into this app — a button that opens the
chooser, a zone they can be dropped on, and optionally the clipboard — and `@/lib/files` reads,
checks and shrinks what arrives. Both use only browser APIs, so there is nothing to install. Do not
hand-roll an `<input type="file">`, a `FileReader` or a drop zone: the ways those go wrong (a drag
highlight that flickers, a file dropped beside the zone replacing the page, an unreadable file
accepted, a URL that leaks) are handled here.

## Choosing, dropping, pasting

```tsx
"use client";
import { useState } from "react";
import { FileDrop } from "@/components/file-drop";
import { resizeImage, useObjectUrl } from "@/lib/files";

export function PhotoPicker() {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const src = useObjectUrl(photo);
  return (
    <div className="space-y-3">
      <FileDrop accept="image/*" maxBytes={20 * 1024 * 1024} label="Choose photo" paste onFiles={async ([file]) => {
        if (!file) return;                          // rejected ones are already listed by FileDrop
        try { setPhoto(await resizeImage(file, { maxEdge: 1600 })); setProblem(null); }
        catch (error) { setProblem((error as Error).message); }   // "x.png is not an image this browser can open."
      }} />
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a blob: URL, which next/image cannot load
        <img src={src} alt="The chosen photo" className="max-h-80 rounded-md" />
      ) : (
        <p className="text-sm text-muted-foreground">No photo yet.</p>
      )}
    </div>
  );
}
```

- `onFiles(files, rejected)` runs for the button, a drop and (with `paste`) a paste anywhere on the
  page. Rejected files are already shown under the zone with the reason; use `rejected` only if the
  page needs to say more.
- **The label says what it does**: "Choose photo", "Add files", "Load JSON". Never "Import" or any
  word for replacing or removing data — this control only brings content in. "Import" and "Export"
  mean moving the app's whole data set, which is a different, destructive action.
  The whole-data-set import from `docs/storage.md` is the one case where "Import data" is the right
  label: it replaces everything, so it is destructive and the check never presses it. Loading
  content is "Choose file" or "Load JSON".
- Every state is visible as text: nothing chosen yet, what was chosen, and what went wrong.
- One `FileDrop` per drop target. Two zones covering the same area fight over the drop.

## Checking a file: type, then content

`accept` and `maxBytes` (and `acceptsFile` on its own) match the MIME type or extension. That is a
filter, not proof: a renamed or corrupt file passes it. The real check is opening the file, and
each opener rejects with a message written for the screen:

- Images: `loadImage(file)` (decode and measure) or `resizeImage(file)` (decode and shrink).
- JSON: `readAsJson<T>(file, check?)` — invalid JSON, or JSON failing your `check` guard, throws
  "settings.json is not valid JSON (…)." Show it, and change nothing.
- Audio and video: set it as the `src` of an `<audio>`/`<video>` (with `useObjectUrl`) and wait for
  `canplay`; on `error`, say the file cannot be played in this browser and drop it.
- Text and CSV: `readAsText(file)`, then validate what you parse.

Show `formatBytes(file.size)` beside a name when size matters.

## Photos: shrink before keeping

A phone photo is several megabytes and thousands of pixels. `resizeImage(file, { maxEdge, type,
quality })` returns a smaller Blob (default longest side 1600, JPEG at 0.85, PNG stays PNG). The
result is upright and carries no EXIF data, so the camera's location does not travel with it. Do it
once, when the file arrives, and keep the result.

## Showing a Blob

`useObjectUrl(blob)` returns a URL for `<img>` (not `next/image`, which cannot load it), `<audio>`,
`<video>` or a link, and revokes it when
the Blob changes or the component unmounts. Never call `URL.createObjectURL` during render.
`readAsDataUrl(blob)` gives a `data:` string instead — only for small images, since it is a third
larger than the bytes.

## Keeping files between visits

If this project has a database (`lib/db.ts`, see `docs/storage.md`), it stores Blobs as they are:
put the resized Blob in a row (`{ id, name, type, blob, addedAt }`) and read it back with
`useObjectUrl`. Two things to know:

- **The JSON export cannot carry a Blob** — it is written with `JSON.stringify`, which turns one
  into `{}`. Either keep small images as data URLs (`readAsDataUrl(await resizeImage(file, {
  maxEdge: 512 }))`), which do travel with the export, or keep media in its own database
  (`defineDatabase({ name: "<app>-media", … })`) that the export does not cover, and say on screen
  that photos stay in this browser.
- Where `docs/sync.md` exists, keep photos in a media-only table referenced by id so the rest can
  move.
- Browsers cap storage. Shrink images first, and show the error if a write fails.

Without a database, files live in React state for this visit only; label them that way.

## Giving a file back

`saveBlob(blob, "edited-photo.jpg")` downloads a Blob — an edited image, a recording, a generated
CSV. Call it from a button; name the button for what it saves ("Save edited photo").

## Client only

All of this runs in the browser: import it from client components and call it from event
handlers and effects, never during render.
