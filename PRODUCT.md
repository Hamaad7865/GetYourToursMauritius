# Product

<!-- impeccable:product-schema 1 -->

Restored 2026-10-10 from the owner's recorded answers (the original file was untracked and lost).
Nothing here was re-interviewed or newly invented.

## Platform

web

## Stack

Next.js 15 (App Router, edge runtime) on Cloudflare Pages, React 19, Tailwind 3, Supabase/Postgres.

## Users

The pre-arrival traveller booking from home, weeks before the trip, mostly on a phone. Not the
visitor already on the island looking for something to do this afternoon.

## Product Purpose

Belle Mare Tours sells Mauritius tours, activities, airport transfers and rentals online, with card
payment and instant confirmation, plus an owner back-office at `/admin`.

## Positioning

We are the operator, not a reseller: direct price, no marketplace markup.

## Operating Context

English is the source language; French lives under `/fr`. The homepage is edge-cached, so anything
personal to a visitor (recently viewed, wishlist, cart) is resolved in the browser, never on the server.

## Capabilities and Constraints

- French parity is mandatory on every new customer-facing surface.
- `/admin` is a first-class designed surface, not an afterthought.
- Images are served unoptimised (full-size originals); keep above-the-fold imagery light.
- Prices, ratings and availability shown anywhere must come from real data.

## Brand Commitments

- GetYourGuide is the binding structural reference for the customer site. Brand stays ours: teal for
  primary actions, coral for urgency, ink for text, white ground, one sans (Plus Jakarta Sans).
- Never describe the business as "family-run".
- No invented claims, sale prices or scarcity cues.

## Evidence on Hand

1,076 guest reviews (TripAdvisor and Google) averaging 4.8/5; Mauritius BRN C09091906; the owner's own
tour photography in the `activity-images` bucket.

## Product Principles

Show the real thing: real photos, real prices, real reviews. Make booking direct feel as easy as a
marketplace.

## Accessibility & Inclusion

WCAG 2.1 AA is the standing bar. Motion respects `prefers-reduced-motion`.
