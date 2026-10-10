# Working in this project

A reviewed Next.js App Router starter. It builds and runs as-is; `app/page.tsx` is a placeholder
meant to be replaced by the product you are asked for.

Read this instead of exploring. It is the whole setup.

## What this project is for

A single-page web app that saves its data in the visitor's browser.

Good for: trackers and planners; calculators and converters; dashboards and charts over data you bring; small tools and text utilities; scoreboards, logs and anything that keeps a history of entries.

Not built for: sharing data between people or devices (data stays in one browser unless the person moves it with a code); accounts or sign-in; calling outside services or APIs.

A request that needs one of these is outside what this project can deliver as it stands: plan the closest thing it can, and say plainly what was left out.

## Stack

Next.js App Router · TypeScript · Tailwind CSS · shadcn/ui · 14 shadcn/ui components pre-installed (dialog, select, table, card, form inputs, tabs, alert) · Dexie (browser database, device-local) · Recharts (themed chart components, already wired to the palette) · Sonner (toast notifications, already mounted) · File API (FileDrop to choose, drop or paste files; lib/files.ts to read, check, resize and save them) · MediaDevices camera (CameraView and lib/camera.ts; opened from a button, never on load) · Web Audio (one shared AudioContext in lib/audio.ts; sound starts on a user gesture) · MediaDevices microphone and MediaRecorder (requestMicrophone, recordMicrophone) · Web Share (ShareButton and lib/share.ts: a result drawn to an image and shared or saved, a link shared or copied) · AI model calls (askModel and useAsk in lib/ai.ts, through the app's own /api/ai route; no key in the app, capped).

## Layout

```
app/identity.ts              the app's name, description and colour; the title, icons, manifest and share image read it. Change them here.
app/layout.tsx               root layout — <html>/<body>, <Providers>, and metadata read from identity.ts.
app/page.tsx                 the placeholder. Replace it.
app/globals.css              Tailwind entry, the design tokens, and the two base rules.
app/providers.tsx            "use client" — composed from this project's modules. Already wired into layout.
types/webgpu.d.ts            WebGPU types, for type-checking only. Nothing here may require WebGPU.
template.capabilities.json   what this template ships, declared for the planner. Keep it accurate.
components/ui/               the shadcn components, already themed. See docs/components.md.
lib/utils.ts                 cn() — the className merge helper every shadcn component expects.
components.json              shadcn config: new-york, neutral, rsc, aliases @/components and @/lib.
lib/storage/                 the shared storage package, vendored in. Do NOT edit; see docs/storage.md.
lib/db.ts                    THIS app's database schema. Tables, indexes, versions. Edit this.
lib/data/<name>.ts           THIS app's queries. Components call these, never Dexie directly. Create it.
components/ui/chart.tsx      the Recharts wrapper. Import from it; do not edit it.
components/file-drop.tsx     the file chooser and drop zone. Use it for every upload; do not hand-roll an input.
lib/files.ts                 read, check, resize, show and save files.
components/camera-view.tsx   camera preview, photo capture and its states. Use it rather than calling getUserMedia.
lib/camera.ts                request, attach, capture and stop a camera stream.
lib/audio.ts                 the shared AudioContext, unlock, mute, microphone request and recording. Use it; do not create another context.
components/share-button.tsx  the share control, with its outcome shown as text. Use it; do not call navigator.share.
lib/share.ts                 draw a share card, share or save an image, share or copy a link.
app/api/ai/route.ts          the app's route to the AI model. Do not edit it; call it through lib/ai.ts.
lib/ai.ts                    askModel, useAsk and the state text. Every model call goes through it.
```

`@/*` resolves to the project root (`tsconfig.json` paths). Import as `@/components/ui/button`.

The app's name, description and colour live in `app/identity.ts`; change them there, never in
`layout.tsx`. The title, the icons, the manifest and the share image all read it.

**That list is the entire project.** There is nothing else to discover, so do not spend steps
exploring for it. If you want to see the conventions before writing, the ones worth opening are
`app/layout.tsx`, `app/page.tsx`, `app/globals.css` and `package.json`.

## What this project ships

Each of these is already installed and already wired up. **Read the document before building on
one** — it carries the worked code, so you do not have to derive it, and it says what the thing
cannot do as well as what it can.

- **Component kit.** 14 shadcn/ui components, the design tokens they need, and the cn() helper. Read `docs/components.md` before building on it.
- **Browser storage.** Dexie over IndexedDB, already set up: schemas, seeding, live queries and export/import. Data lives in one browser on one device — no sync, no sharing between visitors, no server copy. Read `docs/storage.md` before building on it.
- **Charts.** Recharts, wrapped and themed. Series colours follow the project's palette. Read `docs/charts.md` before building on it.
- **Toast notifications.** Sonner toasts, mounted and ready. Call toast() from anywhere on the client. Read `docs/notifications.md` before building on it.
- **Files.** Choosing, dropping and pasting files through one component, plus helpers that check a file by opening it, shrink photos, show Blobs and save them. Read `docs/files.md` before building on it.
- **Camera.** The camera opened from a button, with a live preview, photo capture, a visible blocked or unavailable state, and its tracks stopped when done. Read `docs/camera.md` before building on it.
- **Sound.** Web Audio set up properly: one shared context unlocked on a user gesture, hidden-tab handling, and the microphone with a visible denied state, recording and a level meter. Read `docs/audio.md` before building on it.
- **Sharing.** Share a result as an image sized for stories, posts or link previews, or share a link, with a save or copy fallback where the device has no share sheet. Read `docs/share.md` before building on it.
- **AI helper.** Ask a language model from the app, with no key in it: one call or a hook with thinking, unavailable and limited states, JSON answers in a given shape, and spending capped by the service. Read `docs/ai.md` before building on it.
- **Move to another device.** The app's data moved to another device once, encrypted, with a code that lasts a day. Photos stay. Read `docs/sync.md` before building on it.
- **Visit counts.** Counts how many times the app is opened, for its owner. Already mounted; nothing about visitors is kept. Read `docs/visits.md` before building on it.

Nothing outside the stack above is set up. In particular, unless a document above says otherwise,
there is no backend datastore, no authentication and no external API.

## Conventions

**Server components by default.** Add `"use client"` only to files that need state, effects,
event handlers or browser APIs. Keep the client boundary as low in the tree as you can — a page
can stay a server component with an interactive child island.

**Tailwind v4 has no `tailwind.config.js`.** Configuration lives in CSS. Add design tokens with
`@theme` in `app/globals.css`; there is no JS config file to edit and creating one does nothing.
The theme is **light only** — there is no `.dark` block. Add one if the product wants dark mode.

**Dependencies.** `npm install <pkg>` works — there is a real shell with network access. Install
what the task genuinely needs rather than reimplementing it, and prefer a package that ships its
own types. A large fixed dataset still belongs in its own module under `lib/`, separate from the
component that renders it.

**`npm run lint` is part of your self-check, and one rule fails most runs.**
`react-hooks/set-state-in-effect`: never call a state setter directly in a `useEffect` body. A
value computed from props or state is computed during render (or with `useMemo`); state that should
reset when an id changes is reset with `key={id}`; a value only the browser knows comes from
`useSyncExternalStore`. Setting state inside a callback the effect subscribes to — an event
listener, a timer, a promise's `.then` — is allowed.

**Hydration.** The server renders every client component too, and its HTML must match the first
client render. Never read the current time, `Math.random()`, the visitor's locale or time zone,
`window` or storage during render. Render a placeholder until `useIsHydrated()` from
`@/lib/storage/react` is true, or do the work in an event handler.

**`params` and `searchParams` are Promises (Next 16).** In a page, layout or `generateMetadata`,
type them as `Promise<{ id: string }>` and `await` them; reading `params.id` directly fails the
build.

## What the finished app must do

When you finish, the supervisor runs `npm install`, `npm test --if-present`, `npm run lint
--if-present` and `npm run build`, then opens the built app in a headless browser **and uses it**.
You cannot run that browser and should not try to imitate it; you pass it by building an app that
meets these requirements:

- **Every route renders visible content and throws nothing** — not on load, and not while it is
  being used. No uncaught exceptions, console errors or failed requests. A page that renders
  nothing fails even when the build passed.
- **The main flow starts from a visible, enabled button with an honest text label** that says what
  it does: "Add expense", "New habit", "Create list". It sits on the page itself, not behind a menu,
  a hover or another step. An icon-only button carries an `aria-label` that says the same.
  Anything tappable is at least 32px tall and wide at phone width, nav links included; the
  ui-kit defaults already are, so only custom controls need a size.
- **Entering data uses a real form**: labelled inputs inside a `<form>`, and a submit button named
  for what it does ("Save", "Add"). Submitting it with sensible values visibly adds to the page.
- **Nothing depends on a GPU.** The browser runs headless with no GPU: WebGL 1 and 2 work through
  a software rasteriser (budget a few thousand triangles, not a million) and `navigator.gpu` is
  absent, so nothing may require WebGPU. Anything drawn degrades to something visible rather than a
  blank canvas; if *What this project ships* lists Canvas and 3D, its document has the pattern.
- **Every page renders when opened directly by its URL**, with no sign-in and no prior navigation,
  and the main flow works there. Nothing the product needs exists only behind a dynamic route such
  as `/items/[id]` or a query string.
- **What was added is still there after a reload**, if the app keeps anything at all — the storage
  is already set up (`docs/storage.md`), and nothing is saved until the product's code writes to it.
- **The page title is the app's name from `app/identity.ts`**; the check reads it and a placeholder
  title counts against you. Keep the name and description there true to what the app became. Rewrite
  the description in `app/identity.ts` as what the app is, never the request that asked for it.
- **AI answers come through `lib/ai.ts`**. The check runs it with sample answers instead of a model,
  and the page must show the answer when it arrives, or the unavailable or limited state as text
  when a call fails — never a blank, a spinner that does not end, or a feature that disappears.
- **The check records any read of `navigator.gpu`**, and WebGPU access counts against you unless the
  goal explicitly asks for WebGPU.
- **Destructive actions say so in their label**: Delete, Remove, Clear, Reset, Discard, Sign out,
  Log out, Export, Download, Import, Undo. These are never pressed during the check, so none of them
  can be the only way into what a page does — and a control that hides one behind a harmless label
  is a lie to the person using the app. Import and Export mean moving the app's whole data set in or
  out; a control that loads a file as content — a photo, a document, a JSON file to open — is
  "Choose file", "Add photo" or "Load JSON", is pressed like any other control, and is never
  labelled Import.

`npm run build` passing is not evidence the product works — the untouched starter passes all four
commands. Neither is a page that renders: a tracker whose "Add" button throws renders perfectly.
What is judged is the running application, being used.

## Do not

- **Do not scaffold a new application over this one.** No `create-next-app`, no second `app/`
  directory. Build on what is here.
- **Do not run a dev server.** `next dev` / `npm run dev` are blocked. Use `npm run build` to
  check your work compiles.
- **Do not install Playwright, Puppeteer or Selenium.** Browser automation is blocked; the
  verification step above is how the page gets opened.
- **Do not reimplement something this project already ships.** Every item under "What this project
  ships" is installed, wired up and documented; a second library doing the same job is wasted
  steps and a second source of truth.
- **Do not promise anything the documents above say is impossible.** A screen offering sharing or
  cross-device sync on a device-local database is a screen that lies to the person using it.
  Besides export/import, data reaches another device only through the shipped move panel, where
  `docs/sync.md` exists.
- **Do not delete this file**, any document named above, or `template.capabilities.json`. The
  first two are the briefing for every later task on this repository; the third is how the planner
  knows what this project can do before it writes a single criterion.
