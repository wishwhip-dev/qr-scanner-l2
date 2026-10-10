# Sharing a result

`@/components/share-button` is the one share control, and `@/lib/share` draws a share card and
hands it (or a link) to the device's share sheet. Both use browser APIs only, so there is nothing to
install. Do not call `navigator.share` or draw text on a canvas yourself: the ways those go wrong
(text running off the card, no share sheet on a desktop, a closed sheet treated as an error) are
handled here.

## When to offer it

Offer sharing where someone has something worth showing: a result screen, a score, a finished
drawing, a summary, a streak, a plan they made. One `ShareButton` beside the result, labelled for
what it shares — "Share result", "Share score", "Share my plan". Not in the header, not on every
screen, and not before there is anything to share.

**Never share automatically.** Nothing opens a share sheet, saves an image or copies a link until
the visitor presses the button: not on load, not when a game ends, not on a timer. Browsers refuse a
share sheet without a click anyway, and an unasked one is the fastest way to lose someone's trust.

**Make the result available before the button is shown.** `ShareButton` draws the card shortly
after it appears, so that the press can open the share sheet at once: Safari on iPhone and iPad
refuses a sheet opened after the click waited for anything, drawing included. Render the button
only once the score or result it shares is final, and `makeImage` must work without a click (no
prompts, no reading the file input that was just pressed). If the card is not ready when it is
pressed, the press finishes it and the button says "Tap again to share".

## A share card

```tsx
"use client";
import { ShareButton } from "@/components/share-button";
import { renderShareCard } from "@/lib/share";
import { identity } from "@/app/identity";

export function ResultShare({ score, best }: { score: number; best: number }) {
  return (
    <ShareButton
      label="Share score"
      cacheKey={`${score}/${best}`}
      title={`${score} points`}
      text={`I scored ${score} on ${identity.name}`}
      filename="my-score.png"
      makeImage={() =>
        renderShareCard({
          title: `${score} points`,
          subtitle: "Can you beat it?",
          lines: [`Personal best: ${best}`, "3 levels cleared"],
          format: "story",
        })
      }
    />
  );
}
```

`cacheKey` tells the button when the card would come out differently: pass something that changes
with what the card shows. Without it, the card is re-drawn whenever `makeImage` is a different
function, so either pass a `cacheKey` or wrap `makeImage` in `useCallback`; an inline function with
no key is re-drawn after every render (slow, but never a stale picture).

`renderShareCard({ title, subtitle?, lines?, footer?, accent?, format? })` returns a PNG Blob: the
title large and bold, the subtitle under it, then each of `lines`, on a dark card with an accent
band across the top and the app's name at the bottom. Every part wraps to the card's width; what
still does not fit is left off from the end of `lines`, then the title is cut with "…". Keep the
title to a few words and each line to one short fact.

- `footer` defaults to the app's name and `accent` to the page's theme colour, both of which come
  from `app/identity.ts` (if this app has no such file, pass them).
- Use the visitor's own result, not their personal details: no email address, full name or
  location on a card unless they typed it in to put it there.

## Formats

| `format` | Size | For |
| --- | --- | --- |
| `story` | 1080×1920 | Instagram and Facebook Stories, Reels covers, TikTok, WhatsApp status. Content is kept clear of the top and bottom, where those apps put their own buttons. |
| `square` (default) | 1080×1080 | Feed posts, X, chats and messages. The safe choice when you do not know where it is going. |
| `wide` | 1200×630 | The shape of a link preview. Rarely needed as a file: see below. |

Pick the format for where people will post it. A phone-first app whose results go to Stories wants
`story`; otherwise `square`.

## Sharing the link instead

Without `makeImage`, `ShareButton` shares a link — `url`, or this page's address — and copies it
where there is no share sheet. The preview people see when the link is posted (title, description
and a 1200×630 image) comes free: it is generated from `app/identity.ts`, so there is nothing to
draw. Make sure the name and description there say what the app is.

## What each press can end in

Every state is text under the button, kept until the next press:

- "Preparing image…" while the card is drawn, when it was not ready before the press.
- "Tap again to share" — the card is ready now (or the browser wanted a fresh press); the next press
  shares it. Nothing is saved instead.
- "Shared" — the share sheet took it.
- "Image saved" — no share sheet that takes files here (most desktops), so it was downloaded.
- "Link copied" — no share sheet, so the link is on the clipboard.
- "Not shared" — the visitor closed the sheet. Not an error: nothing else happens.
- "Sharing isn't available here" — no share sheet and no clipboard; the link is written out to copy by hand.

## Your own controls

`shareImage(blob, { title, text?, filename, ifRefused? })` resolves `"shared"`, `"saved"` or
`"cancelled"` (and `"refused"` with `ifRefused: "report"`, when the browser turned the sheet down
instead of the image being saved), and `shareLink(url, { title, text? })` resolves `"shared"`,
`"copied"`, `"cancelled"` or `"unsupported"`; neither rejects. `shareStatusText(outcome)` gives the
sentence for each. Call them from a click handler with the Blob already made — never
`await renderShareCard(...)` inside the handler first — and show the result as text.

To show the card before sharing it, render it once when the result is ready, keep the Blob, show it
in an `<img>` (with `useObjectUrl` from `lib/files` if this app has it) and pass
`makeImage={async () => blob}` with `cacheKey` set to something that changes with the Blob.

## Client only

All of this runs in the browser: import it from client components and call it from event
handlers, never during render.
