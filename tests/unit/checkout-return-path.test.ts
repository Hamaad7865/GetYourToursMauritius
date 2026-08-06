import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '@/lib/checkout/return-path';

/**
 * Where /bookings/{ref}/pay sends the customer once the widget is done.
 *
 * It defaults to /bookings/{ref}, which only renders for the booking's OWNER — BookingConfirmation
 * fetches with a bearer token and otherwise says "Sign in to view booking …". A guest who paid a quote
 * has no account, so that default charges them and then shows them a sign-in wall. `?return=` lets the
 * minting page name a page the guest can actually render (its own /quotes/{ref}).
 *
 * That parameter is attacker-controllable — it arrives in a URL anyone can compose and hand to a
 * customer — so it is an open-redirect hole unless it is pinned to a same-origin RELATIVE path. The
 * dangerous shapes are the ones a naive `startsWith('/')` waves through: `//evil.com` is a
 * protocol-relative URL, and `/\evil.com` is treated as one by every major browser.
 */
describe('safeReturnPath', () => {
  const fallback = '/bookings/BMT0123456789ABC';

  it('keeps a same-origin relative path', () => {
    expect(safeReturnPath('/quotes/Q0A1B2C3D4E5', fallback)).toBe('/quotes/Q0A1B2C3D4E5');
    expect(safeReturnPath('/quotes/Q1?x=1#top', fallback)).toBe('/quotes/Q1?x=1#top');
  });

  it('falls back when nothing was asked for', () => {
    expect(safeReturnPath(undefined, fallback)).toBe(fallback);
    expect(safeReturnPath('', fallback)).toBe(fallback);
    expect(safeReturnPath(['/a', '/b'] as unknown as string, fallback)).toBe(fallback);
  });

  it('refuses anything that can leave this origin', () => {
    for (const hostile of [
      '//evil.com',
      '/\\evil.com',
      '\\\\evil.com',
      'https://evil.com',
      'http://evil.com',
      '//evil.com/quotes/Q1',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'quotes/Q1',
    ]) {
      expect(safeReturnPath(hostile, fallback), `${hostile} was allowed through`).toBe(fallback);
    }
  });

  it('refuses a path carrying whitespace or a control character', () => {
    expect(safeReturnPath('/quotes/Q1\nSet-Cookie: x=y', fallback)).toBe(fallback);
    expect(safeReturnPath('/quotes/ Q1', fallback)).toBe(fallback);
    expect(safeReturnPath(`/${'a'.repeat(600)}`, fallback)).toBe(fallback);
  });
});
