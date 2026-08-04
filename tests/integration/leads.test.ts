import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

describe('F7: lead capture per-IP rate limit', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  const capture = (ip: string | null, name = 'Spammer') =>
    db.pg.query(`select api_capture_lead($1::jsonb) as data`, [
      JSON.stringify({ name, contact: 'x@spam.com', ip }),
    ]);

  it('allows up to 8 leads per IP per hour, then rejects with rate_limited', async () => {
    for (let i = 0; i < 8; i += 1) {
      await capture('203.0.113.7');
    }
    await expect(capture('203.0.113.7')).rejects.toThrow(/rate_limited/);
  });

  it('does not throttle a different IP', async () => {
    await expect(capture('203.0.113.99')).resolves.toBeDefined();
  });

  it('does not throttle when no IP is provided (e.g. server-side / AI assistant)', async () => {
    for (let i = 0; i < 12; i += 1) {
      await expect(capture(null)).resolves.toBeDefined();
    }
  });
});

/**
 * A captured lead used to notify NOBODY — the row sat in /admin/leads until somebody looked. The
 * ContactFloat enquiry form makes that the site's primary contact route, so the owner alert is the
 * feature, not a nicety. These assertions are about the trigger actually FIRING and carrying enough
 * payload for the drain to render the email without a second DB read.
 */
describe('lead capture enqueues an owner alert', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  const outboxFor = async (leadId: string) => {
    const { rows } = await db.pg.query<{
      channel: string;
      recipient: string;
      template: string;
      payload: Record<string, unknown>;
      booking_id: string | null;
    }>(
      `select channel, recipient, template, payload, booking_id from notification_outbox
         where idempotency_key = $1`,
      [`owner_new_lead:${leadId}`],
    );
    return rows;
  };

  const captureFull = async (payload: Record<string, unknown>): Promise<string> => {
    const { rows } = await db.pg.query<{ data: { id: string } }>(
      `select api_capture_lead($1::jsonb) as data`,
      [JSON.stringify(payload)],
    );
    return rows[0]!.data.id;
  };

  it('enqueues exactly one owner email per lead, addressed to the sentinel', async () => {
    const id = await captureFull({ name: 'Ana', contact: 'ana@example.com · +230 5555 1234' });
    const rows = await outboxFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channel).toBe('email');
    // Never the owner's real address — the drain resolves OWNER_NOTIFY_EMAIL at send time.
    expect(rows[0]!.recipient).toBe('owner');
    expect(rows[0]!.template).toBe('owner_new_lead');
    // Ad-hoc notification: there is no booking behind an enquiry.
    expect(rows[0]!.booking_id).toBeNull();
  });

  it('stores the free-text message instead of truncating it into `contact`', async () => {
    // Comfortably past the 200-char cap on `contact` — the reason message got its own column.
    const long = 'Is the catamaran wheelchair accessible? '.repeat(12);
    const id = await captureFull({
      name: 'Ana',
      contact: 'ana@example.com',
      message: long,
      pageUrl: '/airport-transfers',
    });
    const { rows } = await db.pg.query<{ message: string; page_url: string }>(
      `select message, page_url from leads where id = $1`,
      [id],
    );
    expect(rows[0]!.message).toBe(long);
    expect(rows[0]!.page_url).toBe('/airport-transfers');
    const payload = (await outboxFor(id))[0]!.payload;
    expect(payload.message).toBe(long);
    expect(payload.pageUrl).toBe('/airport-transfers');
  });

  it('resolves the activity title into the payload, so the drain needs no second read', async () => {
    // Only an activity row is needed here — no option/price/occurrence chain, since a lead never books.
    const { rows: op } = await db.pg.query<{ id: string }>(
      `insert into operators (name, slug) values ('Lead Op', 'lead-op') returning id`,
    );
    const { rows: act } = await db.pg.query<{ id: string; title: string }>(
      `insert into activities (operator_id, slug, title, category, status)
       values ($1, 'dolphin-swim', 'Dolphin Swim & Snorkelling', 'Catamaran cruises', 'published')
       returning id, title`,
      [op[0]!.id],
    );
    const activity = act[0]!;
    const id = await captureFull({
      name: 'Ana',
      contact: 'ana@example.com',
      interestActivityId: activity.id,
      preferredDate: '2026-09-14',
      partySize: 4,
    });
    const payload = (await outboxFor(id))[0]!.payload;
    expect(payload.activityTitle).toBe(activity.title);
    expect(payload.preferredDate).toBe('2026-09-14');
    expect(payload.partySize).toBe(4);
  });

  it('leaves untouched optional fields null rather than storing empty strings', async () => {
    const id = await captureFull({
      name: 'Ana',
      contact: 'ana@example.com',
      message: '',
      pageUrl: '',
    });
    const { rows } = await db.pg.query<{ message: string | null; page_url: string | null }>(
      `select message, page_url from leads where id = $1`,
      [id],
    );
    expect(rows[0]!.message).toBeNull();
    expect(rows[0]!.page_url).toBeNull();
  });

  it('rejects a party size outside the form’s own 1..99 bound', async () => {
    await expect(
      captureFull({ name: 'Ana', contact: 'ana@example.com', partySize: 0 }),
    ).rejects.toThrow(/leads_party_size_range/);
  });

  // The older forms (ContactForm, InquiryWidget) send no message/page and must keep working.
  it('still alerts on a lead captured the old way, with only name + contact', async () => {
    const id = await captureFull({ name: 'Ana', contact: 'ana@example.com' });
    const rows = await outboxFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.message).toBeNull();
  });
});
