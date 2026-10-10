# Notifications

This project shows toast notifications with [Sonner](https://sonner.emilkowal.ski). **It is already
installed and already mounted.** Do not install a second toast library, do not add another
`<Toaster />`, and do not hand-roll a notification component — there is one, it is global, and it
works from any client component.

## Using it

```tsx
"use client";
import { toast } from "sonner";

toast.success("Saved");
toast.error("Could not save");
toast("Deleted", { action: { label: "Undo", onClick: () => restore(item) } });
```

The four you will actually reach for are `toast()`, `toast.success()`, `toast.error()` and
`toast.promise()`:

```tsx
toast.promise(saveItem(item), {
  loading: "Saving…",
  success: "Saved",
  error: (cause) => `Could not save: ${cause instanceof Error ? cause.message : "unknown error"}`,
});
```

`toast.promise` is the one worth remembering. It resolves the three states of an async action in
one call, which is otherwise three `useState` flags and a `finally` block in every component that
writes something.

## Where the Toaster lives

`app/providers.tsx`, beside `{children}`. That file is composed from the project's template modules
— if you need to change the toaster's position or theme, change the props there, but understand
that a regenerated template will not carry the edit.

## Rules

- **Client components only.** `toast()` is a browser call. Calling it from a server component is a
  build error, and calling it from a server action's body does nothing useful — return a result and
  toast it from the client instead.
- **Toast the outcome, not the intent.** `toast.success("Saved")` after the write resolves, never
  before it starts. A toast that fires optimistically and then fails is worse than no toast.
- **Do not toast on every render or inside an effect with no dependency guard.** It will stack.
- **Errors belong in a toast *and* handled.** A caught error that only becomes a toast is a caught
  error that was swallowed; the toast tells the user, it does not fix the state.
- **Keep the text short and specific.** "Could not save: the list was deleted" beats "Error".
