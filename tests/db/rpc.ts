import type { PGlite } from '@electric-sql/pglite';
import type { DbRpc, RpcParams } from '@/lib/db/rpc';

const ALLOWED = new Set([
  'api_search_activities',
  'api_get_activity',
  'api_list_availability',
  'api_create_hold',
  'api_book',
  'api_create_payment',
  'api_record_payment_charge',
  'api_record_payment_checkout',
  'api_pending_payment_checkouts',
  'api_mark_refunded',
  'api_erase_user',
  'api_get_profile',
  'api_update_profile',
  'api_export_user',
  'api_get_booking',
  'api_my_pending_bookings',
  'api_my_bookings',
  'api_booking_receipt',
  'api_capture_lead',
  'api_my_wishlist',
  'api_add_wishlist',
  'api_remove_wishlist',
  'api_search_transfer_hotels',
  'api_list_transfer_areas',
  'api_transfer_quote',
  'api_submit_review',
  'api_my_reviews',
  'api_search_facets',
  'api_list_categories',
  'api_rate_limit',
  'claim_notifications',
  'mark_notification',
  'api_my_notifications',
  'api_mark_notification_read',
  'api_mark_all_notifications_read',
  'api_notifications_unread_count',
  'run_booking_maintenance',
  'materialize_availability',
  'api_planner_places',
]);

/**
 * Test DbRpc adapter over PGlite — runs the exact same `api_*` SQL the production
 * Supabase client will, so the service layer is verified with zero mock divergence.
 */
export function pgliteRpc(pg: PGlite): DbRpc {
  return {
    async rpc<T>(fn: string, params: RpcParams): Promise<T> {
      if (!ALLOWED.has(fn)) {
        throw new Error(`unknown rpc ${fn}`);
      }
      const { rows } = await pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
        JSON.stringify(params),
      ]);
      return rows[0]!.data;
    },
  };
}

/**
 * Service-role variant of {@link pgliteRpc} — the PGlite mirror of the app's serviceRoleRpcContext().
 * PGlite has ONE session (the test's db.as() claims are session-wide), but some service functions mix
 * identities: createPaymentLink authorizes api_create_payment as the CALLER, then records the charge /
 * checkout id via a service-role port (those RPCs are locked to service_role). This port flips the
 * session to service_role for exactly one call and restores the caller's identity afterwards.
 */
export function pgliteServiceRoleRpc(pg: PGlite): DbRpc {
  return {
    async rpc<T>(fn: string, params: RpcParams): Promise<T> {
      if (!ALLOWED.has(fn)) {
        throw new Error(`unknown rpc ${fn}`);
      }
      // Capture the caller's identity (claims + role) so it can be restored after the call.
      const prev = (
        await pg.query<{ claims: string | null; role: string }>(
          `select current_setting('request.jwt.claims', true) as claims, current_user as role`,
        )
      ).rows[0]!;
      await pg.exec(`reset role;`);
      await pg.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ role: 'service_role' }),
      ]);
      await pg.exec(`set role service_role;`);
      try {
        const { rows } = await pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
          JSON.stringify(params),
        ]);
        return rows[0]!.data;
      } finally {
        await pg.exec(`reset role;`);
        await pg.query(`select set_config('request.jwt.claims', $1, false)`, [prev.claims ?? '']);
        // Only re-assume a Supabase role; anything else (the owner) is the reset-role default.
        if (prev.role === 'anon' || prev.role === 'authenticated' || prev.role === 'service_role') {
          await pg.exec(`set role ${prev.role};`);
        }
      }
    },
  };
}
