import { can, type AdminAccess } from '@/lib/admin/permissions';
import type { AssistantGrants } from '@/lib/services/admin-assistant';

type Row = Record<string, unknown>;

/**
 * The generated Database types lag the schema (no `quotes` table, older `bookings` columns), so the
 * ref lookups go through this narrow cast — the same move the send route makes with its SendClient.
 */
export interface RefLookupClient {
  from(table: 'bookings' | 'quotes'): {
    select(columns: string): {
      eq(
        column: 'ref',
        value: string,
      ): { maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }> };
    };
  };
}

/** A minor-unit column as euros, tolerating null/undefined and non-numeric junk. */
function eurOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value / 100 : null;
}

/**
 * Which PROPOSALS the model may be offered for this caller. Holding the assistant section lets a member
 * ask; the browser applies a proposal under their own session, so the tour-writing tools need
 * `section.tours` and the quote drafter `section.quotes` (the services layer takes plain booleans).
 */
export function assistantGrants(access: AdminAccess): AssistantGrants {
  return { tours: can(access, 'section.tours'), quotes: can(access, 'section.quotes') };
}

/**
 * The admin assistant's `lookup_booking` / `lookup_quote` tools, scoped to the CALLER.
 *
 * They read a guest's name, email and amounts through the SERVICE-ROLE client, which sees every row, so
 * holding the assistant section alone must not be enough: the booking lookup also needs
 * `section.bookings` and the quote lookup `section.quotes`. Without it a lookup answers null — the
 * tool's existing "not found" shape — and the model-facing result is unchanged.
 */
export function buildRecordLookups(
  db: RefLookupClient,
  access: AdminAccess,
): {
  lookupBooking(ref: string): Promise<Record<string, unknown> | null>;
  lookupQuote(ref: string): Promise<Record<string, unknown> | null>;
} {
  return {
    lookupBooking: async (ref) => {
      if (!can(access, 'section.bookings')) return null;
      const { data } = await db
        .from('bookings')
        .select(
          'ref, status, payment_state, customer_name, customer_email, currency, total_minor, deposit_minor, balance_due_minor, pickup_location, created_at',
        )
        .eq('ref', ref.trim().toUpperCase())
        .maybeSingle();
      if (!data) return null;
      const { total_minor, deposit_minor, balance_due_minor, ...rest } = data;
      return {
        ...rest,
        totalEur: eurOf(total_minor),
        depositEur: eurOf(deposit_minor),
        balanceDueEur: eurOf(balance_due_minor),
      };
    },

    lookupQuote: async (ref) => {
      if (!can(access, 'section.quotes')) return null;
      const { data } = await db
        .from('quotes')
        .select(
          'ref, status, customer_name, customer_email, currency, total_minor, valid_until, deposit_bps, sent_at, converted_at, created_at',
        )
        .eq('ref', ref.trim().toUpperCase())
        .maybeSingle();
      if (!data) return null;
      const { total_minor, ...rest } = data;
      return { ...rest, totalEur: eurOf(total_minor) };
    },
  };
}
