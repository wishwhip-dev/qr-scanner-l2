# Components

Use them — a screen built from styled divs is a screen that took longer and looks worse.

**15 shadcn/ui components in `components/ui/`, already themed:**

```
alert  badge  button  card  chart  checkbox  dialog  input  label  select  separator
skeleton  table  tabs  textarea
```

That is the whole list. Anything not on it is not here — see "Adding one that is not here" below.

Import them by alias: `import { Button } from "@/components/ui/button";`

Their default sizes pass the phone tap check (32px); `Button size="sm"` is the smallest that does.

## Which one for which job

| You need | Use |
| --- | --- |
| A panel around a group of things | `Card` (with `CardHeader` / `CardTitle` / `CardContent`) |
| Anything modal — add, edit, confirm | `Dialog` |
| A form field | `Label` + `Input`, or `Textarea` for long text |
| A choice from a fixed set | `Select`, or `Checkbox` for on/off |
| A breakdown of several figures | `Table` |
| A status or a computed figure | `Badge` |
| The loading state before data arrives | `Skeleton` |
| Something the visitor must be told | `Alert` |
| Switching between views of the same thing | `Tabs` |

## Adding one that is not here

**shadcn components are copied in, not imported from a package.** To add another:

```
npx --yes shadcn@latest add --yes <name>
```

**Both `--yes` flags are required.** Without the first, `npx` asks permission to install the CLI;
without the second, the CLI asks to confirm the files. Nobody can answer either prompt, so the
command sits there until it hits the timeout — and you lose the step for nothing.

**Never re-add a component that already ships.** `add --yes` overwrites without asking. If the CLI
fails, write the file into `components/ui/` yourself in the same style as `card.tsx`, and
`npm install` the one `@radix-ui/react-*` package it imports.

## Styling

`app/globals.css` defines the full shadcn neutral token set on `:root` and maps it with
`@theme inline`. That mapping is not decoration: under Tailwind v4 a utility exists only if the
theme declares it, so without it `bg-background` and `text-muted-foreground` are not classes at all.

Whether the theme is light or dark is the shell's choice, and `AGENTS.md` says which. Either way
there is one palette on `:root`.

**Retheme by editing the token values, never by writing colours into components.** A component that
hardcodes `bg-neutral-900` stops following the theme, which is how a previous version of this
template ended up painting a near-black button on a near-black page — invisible to anyone in light
mode, including the headless browser that verifies the work.

**Do not add bare element selectors to `app/globals.css`.** Tailwind v4 emits utilities inside
`@layer utilities`, and an unlayered `p { color: ... }` beats every one of them — so a hardcoded
grey silently wins over `text-muted-foreground` everywhere. The two base rules that exist are
inside `@layer base` for exactly this reason.

## Rules

- **Reach for a shipped component before writing a styled div.**
- **Do not re-add a component that already exists** — `add --yes` overwrites it.
- **Do not hardcode colours.** Use the tokens; retheme by changing their values.
- **Do not add unlayered element selectors to `globals.css`.** They beat every Tailwind utility.
