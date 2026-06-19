# Cart & Hold Lifecycle — Design

> Brainstormed 2026-06-19. One of two separate efforts; the **checkout-flow redesign**
> (3-step pickup/drop-off/route → details → pay, per-item pickup/drop-off, admin visibility,
> removing the dotted red line) is a **separate spec** and out of scope here.

**Goal:** A booking you start no longer gets lost when you click away. Saved tours gather in the
cart; starting checkout reserves their spots for ~30 minutes; the held tours live in the cart with a
live countdown; when the window closes they drop out and a navbar bell tells you. Come back before
30 minutes and you pay from the cart. Inventory is never oversold and the cart never shows a spot the
server has already released.

## Locked decisions

1. **Hold starts at checkout, not while browsing** (Q1 → B). Browsing and "Add to cart" lock no
   inventory. The 30-minute hold begins when you commit at checkout.
2. **State lives in the browser, reconciled with the server** (Q2 → A). The cart + its hold
   references live in `localStorage`; on every load each held line is verified against the server
   (the real inventory record) and dropped if already released. The server hold remains the source
   of truth for inventory — the browser only remembers selections.
3. **"Add to cart" saves; "Checkout" holds everything at once** (Q3 → A). Classic cart model: gather
   tours freely, then one Checkout creates holds for all lines and starts the clock.
4. **Lean, client-side notifications bell** (Q4 → A). The bell covers hold events only (secured /
   expiring / expired), driven by the cart on this device. No new server-side notification
   infrastructure.
5. **Sold-out at checkout → skip and continue** (confirm-point ①). If a line's spot is gone when we
   try to hold it, we flag that line "no longer available," notify, and proceed with the rest.
6. **Removing a held line releases its hold** (confirm-point ②). Otherwise a removed item strands a
   spot for 30 minutes.

## What already exists (reused, not rebuilt)

- A client cart store (`src/lib/cart/useCart.ts`) backed by `localStorage`, and a cart view in the
  navbar.
- `create_hold` (serializes via `SELECT … FOR UPDATE`; no oversell) and the hold-expiry sweep.
- `release_hold` — currently **service-role only** (revoked from `public`/`authenticated` in the
  audit), so owner-initiated release needs an authorized path (below).
- `api_book` already re-checks capacity at booking time, so a hold expiring mid-payment fails
  cleanly instead of overselling.

## The model

```
Browse ──"Add to cart"──▶  cart line {status: saved}      (no hold, no inventory locked)
Cart ────"Checkout"─────▶  create_hold per line
                            ├─ ok      → line {status: held, holdId, expiresAt}
                            └─ soldout → line {status: unavailable} + notify, skip
Held lines stay in the cart with a countdown. Leaving checkout loses nothing.
expiresAt passes (live) OR server says released (on load) → remove line + notify "expired".
Come back before expiry → held line still present → resume payment.
```

## 1. State (client-side, `localStorage`)

`CartItem` gains:

- `status: 'saved' | 'held' | 'unavailable'`
- `holdId?: string`
- `expiresAt?: string` (ISO)

A small **notifications store** (separate `localStorage` key): `Array<{ id, type, message, createdAt,
read }>` where `type ∈ 'secured' | 'expiring' | 'expired' | 'unavailable'`. No new DB tables.

## 2. Checkout = create holds (the one server interaction)

On Checkout, call `create_hold(occurrence, quantity, idempotencyKey)` for each `saved` line.

- **Success** → write `{ holdId, expiresAt }` back onto the line, `status → held`.
- **Capacity failure** (sold out since saved) → `status → unavailable`, post an `unavailable`
  notification, **continue** with the remaining lines (decision #5).
- After holds are created, post one `secured` notification ("Spots secured — pay within 30 min") and
  hand the held lines to the checkout flow (the other spec).
- Each line keeps a stable idempotency key so a retry reuses the same hold rather than stacking
  duplicates.

## 3. Expiry detection (no server push)

- **Live timer:** a single interval (one per app, not per line) checks held lines while the app is
  open; when `expiresAt` passes → remove the line + post `expired`. A line crossing the 5-minute mark
  posts one `expiring` notification.
- **On-load reconcile:** whenever the cart mounts, verify each held line's hold still exists/active
  on the server via a lightweight read; drop any the server has released and post `expired`. This
  covers "expired while the tab was closed" and is what makes decision #2 safe — the cart can never
  show a spot that is actually gone.

## 4. Notifications bell (navbar)

A bell icon with an unread count; clicking opens a dropdown of recent alerts, newest first, marked
read on open. Messages name the tour ("*North Tour* expired"). Purely from the notifications store;
capped to a small recent list. No new routes or tables.

## 5. Resume / pay

The cart's **Checkout/Pay** with active holds launches the new checkout flow (separate spec) for the
held lines. This spec owns only the hold lifecycle and the hand-off; the multi-item pickup/drop-off
and payment UX belong to the checkout-flow spec.

## 6. Edge cases

- **Hold expires during payment:** `api_book` re-checks capacity → clean "your hold expired, please
  re-pick" error; no oversell.
- **Remove a held line:** release the hold server-side via an **owner-scoped release** — an authed
  `api_release_hold(holdId)` RPC that verifies the hold belongs to the caller (since `release_hold`
  is service-role only). Removing a `saved` line is local-only.
- **Sign out:** the cart stays in this browser's `localStorage`; it reconciles against the server on
  next load (held lines the user no longer owns / that expired are dropped).
- **Clock skew / stale tab:** trust the server reconcile over the local timer; the timer is a UX
  convenience, the reconcile is authoritative.

## 7. Testing

- **Unit:** cart reducer — `saved → held` transition, `unavailable` skip, expiry removal, reconcile
  drops released lines; notifications store (dedupe, read, cap).
- **Integration (PGlite):** multi-line `create_hold` with one sold-out line (skip + continue);
  `api_release_hold` releases only the owner's hold and frees capacity; the no-oversell invariant
  holds across concurrent holds.

## Out of scope (separate specs)

- The 3-step checkout flow, per-item pickup/drop-off, the "confirm full route" map step, removing the
  dotted red line, the GetYourGuide-style personal-details page.
- Admin visibility of pickup / drop-off / itinerary.
- A general (server-persisted, cross-device) notifications hub.

## Likely files

- `src/lib/cart/useCart.ts` (state + reducer), a new `src/lib/cart/holds.ts` (create/reconcile/
  release helpers), a notifications store (`src/lib/notifications/inbox.ts` client store).
- Cart view component + a new navbar `NotificationsBell` component.
- A new authed endpoint/RPC for owner-scoped hold release (`api_release_hold`), mirrored into
  `supabase/catch-up.sql` (owner re-runs on the live DB).
- Tests under `tests/unit/` and `tests/integration/`.
