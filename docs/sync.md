# Move to another device

This app's data lives in one browser (see `docs/storage.md`). `components/move-panel.tsx` lets the
person take all of it to another phone or computer, once, with a code. Nothing else moves data
between devices, and nothing moves on its own.

## Placing it

Put the panel once, on the app's settings screen: a page of its own (`app/settings/page.tsx`,
linked from the app's navigation), never a dialog or popover, because the link carrying a code opens
that page. Render it from a client component (`"use client"`: the database cannot be handed over
from a server component):

```tsx
import { MovePanel } from "@/components/move-panel";
import { database } from "@/lib/db";

<MovePanel database={database} />
```

Do not edit `components/move-panel.tsx` or `lib/sync.ts`. Every sentence the panel shows is in
`MOVE_COPY` in `lib/sync.ts`; keep them, because they are the promise (one code, one day, photos
stay). Never call the panel's feature anything but "Move to another device".

## How it works

1. On the first device, "Move to another device" takes a snapshot of the database, encrypts it
   with a new code and shows the code (`XXXXX-XXXXX-XXXXX-XXXXX`) and a link carrying it. Nothing
   on that device changes.
2. On the second device, "I have a code" (or opening the link) fetches the copy, checks it, and
   asks "Replace what's on this device with the moved data?" with a count per table. Only
   "Import and replace" changes anything: every moved table is emptied and refilled. If the copy
   cannot be used there, it is handed back under the same code, so the person can try again.

- **The code is the key.** The copy is encrypted with it in the browser; WishWhip keeps only
  scrambled bytes and cannot read them. A lost code cannot be recovered: move again.
- **One day, one use.** The copy is deleted the first time it is fetched, or after 24 hours. A
  wrong, used or expired code shows "That code isn't right or has expired." and changes nothing.
- **Whoever has the code gets a copy**, so it can hand a list to someone else too. It is a copy,
  not a shared list: later changes on either device stay there.
- The address comes from `NEXT_PUBLIC_WISHWHIP_SYNC_URL`, which WishWhip sets on the live site. Do
  not set it or hard-code an address. Where it is not set, the panel says "Moving works on the live
  site, not here", and the code only works inside the same open page.

## What moves and what does not

Every table of the database passed to the panel moves, except a table holding Blobs, Files or
binary data (photos, recordings) on either device: JSON cannot carry those, so that whole table
stays as it is on both, and the panel names it ("Left here: recipes (has photos)"). So media must
live in a media-only table (`{ id, blob, type }`) that records point at by id, never in a field of
a record: a recipe with a photo field would keep every recipe from moving. A separate media
database (`defineDatabase({ name: "<app>-media" })`, see `docs/files.md`) works too. Say on screen
that photos stay on the device. Store dates as epoch millis (`Date.now()`), never `Date` objects,
which arrive as text.

A copy made by a newer version of the app is refused with "Open the app's newest version first";
an older one is fine.

## Rules

- **Never move data automatically**, on load or on a timer. Only the person's press does.
- **Never add accounts, sign-in, analytics or trackers** to make this work. The code is the only
  link between the devices.
