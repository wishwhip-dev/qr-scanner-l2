# Asking an AI model

`@/lib/ai` asks a language model a question and gives back the answer: `askModel` for one call,
`useAsk` for a component that shows its state. It goes through this app's own route,
`app/api/ai/route.ts`, which is already set up. There is no API key in this app and none to add —
do not install an AI SDK, call a provider directly, or create an `AI_`/`OPENAI_` variable. Do not
edit the route, and do not `fetch("/api/ai")` yourself: the route answers only JSON from this app's
own pages, which is what `askModel` sends, and refuses anything else.

## Use it for helpers, never for the core of the app

The model is an extra: summarise a note, suggest a name, rewrite a sentence, explain a result,
write another quiz question. **The app must work without it.** It can be unavailable, slow or out
of allowance at any moment, so the main flow never waits on an answer: a quiz has its own
questions and the model adds more; a notes app saves and lists notes, and the summary is a button.

Never use it for what code does exactly: arithmetic, sorting, searching, dates, unit conversion,
validation. Code is instant, free and right every time.

## A worked example

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AI_PRIVACY_NOTE, useAsk } from "@/lib/ai";

export function NoteSummary() {
  const [note, setNote] = useState("");
  const { ask, text, statusText, busy } = useAsk();
  return (
    <div className="space-y-2">
      <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Paste a note" />
      <p className="text-xs text-muted-foreground">{AI_PRIVACY_NOTE}</p>
      <Button disabled={busy || !note.trim()} onClick={() => ask(note, {
        system: "Summarise the user's note in two plain sentences.",
        maxTokens: 200,
      })}>
        {busy ? "Summarising…" : "Summarise"}
      </Button>
      {statusText && <p role="status" className="text-sm text-muted-foreground">{statusText}</p>}
      {text && <p className="text-sm">{text}</p>}
    </div>
  );
}
```

`askModel(input, options)` is the same without the state: it returns
`{ ok: true, text, data? }` or `{ ok: false, reason, message }`, and never throws.

## Every state is on the page, as text

An AI feature has more states than most, and each one must be visible:

| `status` | Show |
| --- | --- |
| `idle` | the input and the button |
| `thinking` | "Thinking…" (`statusText`), and the button disabled so it is not pressed twice |
| `done` | the answer (`text`, or what you made from `data`) |
| `unavailable` | `statusText`: the assistant isn't available, try again |
| `limited` | `statusText`: the assistant has reached its limit for now |
| `error` | `statusText`: the question was too long or the answer unreadable |

On failure show `result.message` (`statusText` already is it) and keep what the person typed, so
they can try again without retyping. Never hide the feature or leave a spinner that does not end,
and do not retry by yourself.

## Say that text goes to a model

Beside every input whose text is sent to the model, show this line (it is `AI_PRIVACY_NOTE`):

> Text you enter is sent to an AI model provider.

Required, not a style choice. Send only what the feature needs: no names, email addresses, phone
numbers or other personal details unless the person typed them for this feature, and never
anyone else's data.

## Keep prompts small

One question carries at most 8,000 characters across every message and the `system` text, which
is cut to 1,000. Over the limit, `askModel` returns `too-long` without sending anything.

Summarise locally first. To ask about a history of entries, send the totals, counts and the few
entries that matter, not every record: "42 workouts this month, mostly runs, longest 12 km" is a
better prompt than 42 rows, and costs a fraction. Answers are short too: `maxTokens` defaults to
400 (about 300 words) and cannot exceed 1,000.

## Structured answers: JSON with an example

To get fields rather than prose, pass `json: true` and an `example` of the object you want. The
model answers in that shape, and the parsed object is `data`:

```ts
const result = await askModel(`Three dinner ideas using: ${ingredients.join(", ")}`, {
  json: true,
  example: { ideas: [{ name: "Tomato pasta", minutes: 20, why: "Uses the tomatoes and basil" }] },
});
if (result.ok) {
  const ideas = (result.data as { ideas?: unknown }).ideas;
  if (Array.isArray(ideas)) setIdeas(ideas.filter(isIdea));   // check the shape before trusting it
}
```

Make the example realistic and complete: it is the shape the page is built against. A model can
still leave a field out, so check `data` with a small type guard and show the `error` state when it
does not fit.

## Calls are limited, so make each one count

Every call has a cost, and there are limits per visitor, per app per day and per month. When one is
reached the status is `limited` and the feature waits until it resets.

- Ask on a click or a submit. Never on load, on every keystroke, on a timer, or in an effect
  that runs when its own answer arrives.
- One call per action. Do not loop over items calling the model for each; send them together.
- Keep an answer in state and show it again rather than asking the same question twice.

Where the app is not deployed, the route may answer with a short sample instead of the model — a
sentence about the question, or your `example` in JSON mode. Build the page exactly as for a real
answer; nothing in the app should check which it got.
