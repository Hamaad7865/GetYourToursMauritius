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
