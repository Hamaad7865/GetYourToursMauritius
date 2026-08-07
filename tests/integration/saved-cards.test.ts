import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

// Saved-cards data layer: server-side harvest write (service_role), owner-scoped list/delete
// (authenticated), RLS isolation, and FK cascade on account deletion.

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('saved cards', () => {
  let db: TestDb;

  async function saveCard(
    params: Record<string, unknown>,
  ): Promise<{ id: string; saved: boolean }> {
    await db.as({ role: 'service_role' });
    const { rows } = await db.pg.query<{ data: { id: string; saved: boolean } }>(
      `select api_save_card($1::jsonb) as data`,
      [JSON.stringify(params)],
    );
    return rows[0]!.data;
  }
  async function listCards(sub: string): Promise<Array<Record<string, unknown>>> {
    await db.as({ sub, role: 'authenticated' });
    const { rows } = await db.pg.query<{ data: Array<Record<string, unknown>> }>(
      `select api_list_saved_cards('{}'::jsonb) as data`,
    );
    return rows[0]!.data;
  }
  async function deleteCard(sub: string, id: string): Promise<void> {
    await db.as({ sub, role: 'authenticated' });
    await db.pg.query(`select api_delete_saved_card($1::jsonb) as data`, [JSON.stringify({ id })]);
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const id of [USER_A, USER_B, USER_C]) {
      await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [
        id,
        `${id}@example.com`,
      ]);
    }
  });
  afterAll(() => db.close());

  it('harvests a card server-side and lists metadata to the owner — never the token', async () => {
    const saved = await saveCard({
      userId: USER_A,
      registrationId: 'reg_alpha',
      brand: 'VISA',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
    expect(saved.saved).toBe(true);

    const list = await listCards(USER_A);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ brand: 'VISA', last4: '4242', expMonth: 12, expYear: 2030 });
    // The opaque Peach token must never reach the browser.
    expect(JSON.stringify(list)).not.toContain('reg_alpha');
  });

  it('upserts on (user, token): re-saving refreshes metadata, never duplicates', async () => {
    await saveCard({
      userId: USER_A,
      registrationId: 'reg_alpha',
      brand: 'VISA',
      last4: '4242',
      expMonth: 1,
      expYear: 2031,
    });
    const list = await listCards(USER_A);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ expMonth: 1, expYear: 2031 });
  });

  it('isolates cards by owner (RLS + api seam)', async () => {
    await saveCard({
      userId: USER_B,
      registrationId: 'reg_beta',
      brand: 'MASTERCARD',
      last4: '5555',
    });
    expect((await listCards(USER_A)).map((c) => c.last4)).toEqual(['4242']);
    expect((await listCards(USER_B)).map((c) => c.last4)).toEqual(['5555']);
  });

  it('exposes the opaque tokens to the SERVICE role only (for widget cardTokens reuse)', async () => {
    await db.as({ role: 'service_role' });
    const { rows } = await db.pg.query<{ data: string[] }>(
      `select api_list_card_tokens($1::jsonb) as data`,
      [JSON.stringify({ userId: USER_A })],
    );
    expect(rows[0]!.data).toContain('reg_alpha'); // the real token, server-side only
    // An authenticated caller cannot read raw tokens.
    await db.as({ sub: USER_A, role: 'authenticated' });
    await expect(
      db.pg.query(`select api_list_card_tokens($1::jsonb) as data`, [
        JSON.stringify({ userId: USER_A }),
      ]),
    ).rejects.toThrow();
  });

  it('refuses api_save_card from a non-service (authenticated) caller', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    await expect(
      db.pg.query(`select api_save_card($1::jsonb) as data`, [
        JSON.stringify({ userId: USER_A, registrationId: 'reg_evil' }),
      ]),
    ).rejects.toThrow();
  });

  it('lets the owner delete their own card, but not another user’s', async () => {
    const id = (await listCards(USER_A))[0]!.id as string;
    await deleteCard(USER_B, id); // wrong owner — no-op
    expect((await listCards(USER_A)).some((c) => c.id === id)).toBe(true);
    await deleteCard(USER_A, id); // owner — removes it
    expect((await listCards(USER_A)).some((c) => c.id === id)).toBe(false);
  });

  it('deletes saved cards when the profiles row is erased (GDPR erase step, auth.users retained)', async () => {
    await db.asOwner();
    await db.pg.query(`insert into profiles (id) values ($1) on conflict (id) do nothing`, [
      USER_C,
    ]);
    await saveCard({ userId: USER_C, registrationId: 'reg_delta', brand: 'VISA', last4: '1111' });
    expect((await listCards(USER_C)).map((c) => c.last4)).toEqual(['1111']);
    // api_erase_user deletes profiles first; auth.users removal is a separate, fallible step.
    await db.asOwner();
    await db.pg.query(`delete from profiles where id = $1`, [USER_C]);
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from saved_cards where user_id = $1`,
      [USER_C],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('cascades saved_cards when the auth user is deleted (hard-erase / GDPR)', async () => {
    await saveCard({ userId: USER_B, registrationId: 'reg_gamma', brand: 'VISA', last4: '0000' });
    await db.asOwner();
    await db.pg.query(`delete from auth.users where id = $1`, [USER_B]);
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from saved_cards where user_id = $1`,
      [USER_B],
    );
    expect(rows[0]!.n).toBe(0);
  });
});
