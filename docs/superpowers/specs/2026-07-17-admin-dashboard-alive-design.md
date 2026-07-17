# Admin back-office — "make it come alive" (Phase 1) + Reports & Tax (Phase 2)

**Date:** 2026-07-17
**Owner ask (verbatim intent):** the back-office is dull / not dynamic; no logo top-left; charts don't
respond on hover; no reporting module (owner needs to know monthly tax); "every component should be
clickable — the web app should have a soul."

Split into two projects. **Phase 1 (this spec, build now): make the dashboard come alive.** **Phase 2
(captured, build next): Reports & Tax.**

---

## Phase 1 — make it come alive

### 1. Real logo in the sidebar

- Extend `src/components/site/Logo.tsx` with optional props: `href` (default `/`), `className`
  (default `h-14 w-auto sm:h-16`), `label` (default `Belle Mare Tours — home`). No behaviour change
  for existing public-site usages.
- `src/components/admin/AdminShell.tsx` `SidebarHeader`: replace the generic `IconGrid` gradient block
  with `<Logo tone="dark" href="/admin" className="h-11 w-auto" label="Belle Mare Tours back office" />`
  (`tone="dark"` = `/logo-dark.svg`, the white-script art made for the dark `bg-ink` sidebar). Keep a
  small `BACK OFFICE` caption. The logo already contains the wordmark, so drop the duplicate text.

### 2. Interactive revenue chart

- **Data layer** (`src/lib/admin/dashboard.ts`, pure `computeDashboard`): add a `revenue` view-model:
  ```
  interface RevenuePoint { label: string; value: number }         // value = net cash (EUR) that bucket
  interface RevenueSeries { points: RevenuePoint[]; totalEur: number; deltaPct: number | null }
  revenue: { '7d': RevenueSeries; '4w': RevenueSeries; '12m': RevenueSeries }
  ```
  - Net cash basis = `netPaidEur` bucketed by `createdAt` in Mauritius local day (same basis the current
    `spark`/`revenueWeekEur` already use — no money-semantics change).
  - `7d`: 7 daily buckets ending today. `4w`: 4 rolling 7-day buckets. `12m`: 12 calendar-month buckets.
  - `deltaPct` = round((thisWindowTotal − prevWindowTotal) / prevWindowTotal × 100); `null` when the
    previous window is 0 (no divide-by-zero, no fabricated %). This is the honest "vs last period" figure.
  - **Keep `spark` (7-day, length 7) unchanged** so `tests/unit/admin-dashboard.test.ts` stays green;
    `revenue['7d'].points` mirrors it.
  - Honest cap note: derives from the most-recent ~300 bookings (`loadBookings`). Fine for 7d/4w and for
    12m while all-time volume < a few hundred (true today). Phase 2 Reports switches to date-ranged
    queries so nothing is capped.
- **Component** `src/components/admin/RevenueChart.tsx` (new, client): hand-rolled SVG area+line (zero
  new deps, edge-safe, brand teal) with: a `7D / 4W / 12M` segmented toggle (real `<button aria-pressed>`),
  hover crosshair + tooltip (label + euro), a faint baseline gridline, end-dot. `role="img"` +
  descriptive `aria-label`; the hero total + KPI cards carry the numbers as text (chart is supplementary).
  Reduced-motion: no entrance animation on the chart itself; hover is user-driven, not autoplay.

### 3. Everything clickable ("soul")

- **KPI cards → deep-linked bookings filters** (cards become `<Link>`):
  - Departures today → `/admin/bookings?date=today`
  - Revenue this week → `/admin/bookings?pay=paid`
  - Pending payments → `/admin/bookings?pay=pending`
  - Upcoming departures → `/admin/bookings?date=next7`
- **Rows → open the booking drawer**: recent-booking rows, today's-departure rows, and needs-attention
  rows link to `/admin/bookings?open=<id>` (one click opens the existing drawer).
- **`src/components/admin/AdminBookings.tsx`**: seed `status` / `pay` / `dateF` / `selectedId` from URL
  params (`?status=`, `?pay=`, `?date=`, `?open=`) via `useState` initializers, mirroring the existing
  `?q=` seed. Validate each param against its allowed values (ignore junk → `all`). No re-sync effects
  for these (nothing pushes them mid-screen, unlike the top-bar `?q=`), so they never fight the user.
- **Revenue KPI card + Revenue card**: show the real `revenue['7d'].deltaPct` (green ▲ / coral ▼ /
  hidden when null). Replaces the hard-coded "7d" chip.

### 4. Polish / life

- Reveal-on-load: wrap dashboard sections in the existing reduced-motion-safe `animate-fade-up`.
- Card interactivity: `group` + `hover:border-teal` + subtle shadow lift (box-shadow, not transform →
  safe under reduced motion) + a corner arrow (`IconArrowRight`/`IconChevron`) that fades in on
  `group-hover`. Rows already have `hover:bg`; keep + ensure a pointer cursor.
- No new CSS keyframes needed (reuse `animate-fade-up`; hover uses colour/shadow only).

### Testing (Phase 1)

- Extend `tests/unit/admin-dashboard.test.ts`: `revenue` has all 3 series with correct point counts
  (7/4/12); 7d total == `revenueWeekEur`; `deltaPct` sign vs a seeded prior window; `deltaPct === null`
  when the prior window is empty; 12m calendar bucketing; empty-list safety. Keep existing assertions.
- Full gate: typecheck, lint, format, `test:coverage`, build (pages:build in CI).

### Adversarial review (Phase 1, after implementing)

Per-feature adversarial bug review workflow: (a) logo swap (link target, layout, mobile drawer, caching
rename rule), (b) revenue data-layer (bucketing/delta/timezone/divide-by-zero/cap honesty), (c)
RevenueChart (hover math, toggle, empty/single-point, a11y, dark), (d) clickable/deep-link (param
validation, drawer open-by-id, no injection, filters don't fight user). Fix confirmed findings, re-gate.

---

## Phase 2 — Reports & Tax (captured, not built now)

New `/admin/reports` section (owner wants all four):

1. **Monthly VAT collected** — per month: gross sales + the 15% VAT-inclusive portion (`gross × 15/115`).
   Caveat surfaced in-UI: informational only, assumes VAT-registered at 15% inclusive; owner/accountant
   decide what's owed. Confirm Belle Mare's real VAT status before relying on it.
2. **Revenue & refunds (P&L)** — money in, refunds out, net kept, by month.
3. **Per-tour & per-source** — best/worst sellers and channel mix.
4. **Export** — CSV (reuse `csvCell`) and a clean PDF (reuse the edge-safe pdf-lib path from invoices).
   Data: switch from the ~300-row `loadBookings` to a date-ranged aggregate (RPC or a wider fetch) so long
   ranges are never capped. Its own spec → plan → implement cycle.
