/**
 * Deletes the sandbox photography data, transactionally:
 *   1. every booking that touches a Photography-category activity (with all FK dependents —
 *      payment_events, holds, supplements, booking_photos, notifications…), and
 *   2. the "Holiday Session" package activity (slug `holiday-photo`) with its options,
 *      occurrences, images, translations and supplements.
 *
 * The dependent rows are discovered from the live FK graph (pg_constraint), not a hand-written
 * list, so catch-up drift can't leave a RESTRICT surprise. Everything runs in ONE transaction —
 * a failure rolls back and deletes nothing.
 *
 *   npx tsx scripts/sandbox/delete-photography.ts
 *
 * ⚠️  TEST project only. It reads SUPABASE_DB_URL from .env.local — check it first.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function clientConfig(url: string): pg.ClientConfig {
  const rest = url.replace(/^postgres(?:ql)?:\/\//i, '');
  const at = rest.lastIndexOf('@');
  const creds = rest.slice(0, at);
  const hostPart = rest.slice(at + 1);
  const colon = creds.indexOf(':');
  const [hostPort, db] = hostPart.split('/');
  const [host, port] = (hostPort ?? '').split(':');
  return {
    host,
    port: port ? Number(port) : 5432,
    user: colon === -1 ? creds : creds.slice(0, colon),
    password: colon === -1 ? '' : creds.slice(colon + 1),
    database: (db ?? 'postgres').split('?')[0] || 'postgres',
    ssl: { rejectUnauthorized: false },
  };
}

const url = { ...loadEnvLocal(), ...process.env }.SUPABASE_DB_URL;
if (!url) {
  console.error('Missing SUPABASE_DB_URL in .env.local');
  process.exit(1);
}

interface Edge {
  child: string;
  col: string;
  parent: string;
}

const client = new pg.Client(clientConfig(url));

async function main() {
  await client.connect();
  await client.query('begin');

  const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

  // Every single-column FK edge in the public schema: child table + column → parent table.
  const { rows: edges } = await client.query<Edge>(`
    select conrelid::regclass::text as child,
           (select attname from pg_attribute
             where attrelid = conrelid and attnum = conkey[1]) as col,
           confrelid::regclass::text as parent
    from pg_constraint
    where contype = 'f' and connamespace = 'public'::regnamespace and array_length(conkey, 1) = 1
  `);

  const pkCache = new Map<string, string>();
  async function pkOf(table: string): Promise<string> {
    const cached = pkCache.get(table);
    if (cached) return cached;
    const { rows } = await client.query<{ attname: string }>(
      `select a.attname from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = $1::regclass and i.indisprimary
       order by array_position(i.indkey, a.attnum) limit 1`,
      [table],
    );
    const pk = rows[0]?.attname ?? 'id';
    pkCache.set(table, pk);
    return pk;
  }

  const deleted: Record<string, number> = {};
  const visiting = new Set<string>();

  /** Post-order cascade: delete children (recursively) before the parent rows. */
  async function cascade(table: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const key = table;
    if (visiting.has(key)) return; // FK cycle guard (self-referencing trees)
    visiting.add(key);
    try {
      for (const edge of edges.filter((e) => e.parent === table)) {
        const pk = await pkOf(edge.child);
        const { rows } = await client.query<{ id: string }>(
          `select ${quote(pk)} as id from ${quote(edge.child)} where ${quote(edge.col)} = any($1::uuid[])`,
          [ids],
        );
        const childIds = rows.map((r) => r.id);
        await cascade(edge.child, childIds);
        const res = await client.query(
          `delete from ${quote(edge.child)} where ${quote(edge.col)} = any($1::uuid[])`,
          [ids],
        );
        if (res.rowCount) deleted[edge.child] = (deleted[edge.child] ?? 0) + res.rowCount;
      }
    } finally {
      visiting.delete(key);
    }
  }

  // 1. Photography bookings (bookings whose items belong to a Photography activity).
  const { rows: doomedBookings } = await client.query<{ id: string; ref: string }>(`
    select distinct b.id, b.ref
    from bookings b
      join booking_items bi on bi.booking_id = b.id
      join activity_options ao on ao.id = bi.activity_option_id
      join activities a on a.id = ao.activity_id
    where lower(trim(a.category)) = 'photography'
  `);
  const bookingIds = doomedBookings.map((b) => b.id);
  console.log(
    `photography bookings found: ${bookingIds.length} (${doomedBookings.map((b) => b.ref).join(', ') || '—'})`,
  );

  // 2. The Holiday Session package.
  const { rows: acts } = await client.query<{ id: string; title: string }>(
    `select id, title from activities where slug = 'holiday-photo'`,
  );
  const activityIds = acts.map((a) => a.id);
  console.log(`package found: ${acts.map((a) => a.title).join(', ') || '—'}`);

  await cascade('bookings', bookingIds);
  await cascade('activities', activityIds);

  // Also sweep photography bookings' activity_options children that no longer have a booking
  // (session_occurrences / holds belong to the option, not the booking).
  const { rows: optIds } = await client.query<{ id: string }>(
    `select id from activity_options where activity_id = any($1::uuid[])`,
    [activityIds],
  );
  await cascade(
    'activity_options',
    optIds.map((o) => o.id),
  );

  // Text-linked leftovers with no FK: notification rows keyed by the booking ref.
  const refs = doomedBookings.map((b) => b.ref);
  if (refs.length) {
    for (const table of ['notification_outbox', 'notifications']) {
      const { rows: cols } = await client.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = $1`,
        [table],
      );
      const names = cols.map((c) => c.column_name as string);
      const refCol = names.find((n) => /booking_ref|ref/.test(n));
      if (refCol) {
        const res = await client.query(
          `delete from ${quote(table)} where ${quote(refCol)} = any($1::text[])`,
          [refs],
        );
        if (res.rowCount) deleted[table] = (deleted[table] ?? 0) + res.rowCount;
      }
    }
  }

  // The parents themselves, last.
  if (bookingIds.length) {
    const res = await client.query(`delete from bookings where id = any($1::uuid[])`, [bookingIds]);
    deleted.bookings = res.rowCount ?? 0;
  }
  if (activityIds.length) {
    await client.query(`delete from activity_options where activity_id = any($1::uuid[])`, [
      activityIds,
    ]);
    const res = await client.query(`delete from activities where id = any($1::uuid[])`, [
      activityIds,
    ]);
    deleted.activities = res.rowCount ?? 0;
  }

  await client.query('commit');
  console.log('\ndeleted rows by table:');
  for (const [table, n] of Object.entries(deleted).sort()) console.log(`  ${table}: ${n}`);
  console.log('✓ committed');
}

main()
  .catch(async (e) => {
    console.error('✗ rolled back:', e instanceof Error ? e.message : e);
    await client.query('rollback').catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => void client.end());
