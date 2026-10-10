# Visit counts

This project tells its owner how many times the app is opened. `components/visit-beacon.tsx` is
already mounted in `app/providers.tsx`; there is nothing to call and nothing to add.

## What is counted

One visit per browser session: when someone opens the app, the browser sends one empty request to
WishWhip. Nothing about the visitor goes with it: no cookie, no identifier, no page path, no IP
address kept; the browser sends only the app's origin as referrer, which is not kept. Visitors whose
browser asks not to be tracked (Global Privacy Control) are not counted. The owner sees two numbers, opens in the last 7 days and in the last 30.

The address comes from `NEXT_PUBLIC_WISHWHIP_VISIT_URL`, which WishWhip sets when the app is
deployed. Do not set it, and do not hard-code an address. Where it is not set, the component does
nothing.

## Rules

- **Do not edit, move or remove `VisitBeacon`**, and keep it in `app/providers.tsx`.
- **Do not add analytics or trackers** of any kind: no analytics scripts, pixels, tag managers or
  session recorders, and no code that sends anything about visitors anywhere. This count is the only
  one the app has.
- **Do not set `Referrer-Policy: no-referrer` or `same-origin`, or a `Content-Security-Policy` with
  `connect-src 'self'`**. Either stops the count from reaching WishWhip. The template sets neither.
