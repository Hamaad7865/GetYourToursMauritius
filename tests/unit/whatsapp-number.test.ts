import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE } from '@/lib/seo/site';

/**
 * `readWhatsAppNumber` is the plain (uncached) core behind `getWhatsAppNumber`. Its whole job is the
 * FALLBACK contract: the site's "Chat on WhatsApp" links must never break because the setting is
 * unset, blank, or Supabase hiccuped — every one of those resolves to `SITE.phone`.
 *
 * The mocked `maybeSingle` is a PLAIN async function (not a `vi.fn`): a `vi.fn` whose implementation
 * throws leaves a phantom rejected promise in the spy's result tracking that Vitest reports as an
 * unhandled rejection, even though `readWhatsAppNumber` catches the real one. A plain function has no
 * such machinery.
 */
let outcome: { data: { whatsapp_number: string | null } | null } | 'throw' = { data: null };

vi.mock('@/lib/supabase/client', () => ({
  createUserClient: () => ({
    from: () => ({
      select: () => ({
        limit: () => ({
          maybeSingle: async () => {
            if (outcome === 'throw') throw new Error('supabase unreachable');
            return outcome;
          },
        }),
      }),
    }),
  }),
}));

const { readWhatsAppNumber } = await import('@/lib/settings/whatsapp-number');

describe('readWhatsAppNumber', () => {
  beforeEach(() => {
    outcome = { data: null };
  });

  it('returns the stored number when one is set', async () => {
    outcome = { data: { whatsapp_number: '+230 5 111 2222' } };
    expect(await readWhatsAppNumber()).toBe('+230 5 111 2222');
  });

  it('trims surrounding whitespace off the stored number', async () => {
    outcome = { data: { whatsapp_number: '  23051112222 ' } };
    expect(await readWhatsAppNumber()).toBe('23051112222');
  });

  it('falls back to SITE.phone when the number is null', async () => {
    outcome = { data: { whatsapp_number: null } };
    expect(await readWhatsAppNumber()).toBe(SITE.phone);
  });

  it('falls back to SITE.phone when the number is blank', async () => {
    outcome = { data: { whatsapp_number: '   ' } };
    expect(await readWhatsAppNumber()).toBe(SITE.phone);
  });

  it('falls back to SITE.phone when there is no row yet', async () => {
    outcome = { data: null };
    expect(await readWhatsAppNumber()).toBe(SITE.phone);
  });

  it('falls back to SITE.phone when the read throws', async () => {
    outcome = 'throw';
    expect(await readWhatsAppNumber()).toBe(SITE.phone);
  });
});
