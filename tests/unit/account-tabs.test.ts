import { describe, expect, it } from 'vitest';
import { accountTabs, isActiveAccountTab } from '@/components/account/account-tabs';

/**
 * The account rail. The owner's rule: a customer with no delivered photo gallery must not see a
 * Galleries tab at all — it only exists once there is something to open, and sits right after
 * Bookings.
 */
const hrefs = (hasGalleries: boolean) => accountTabs(hasGalleries).map((t) => t.href);

describe('accountTabs', () => {
  it('has no Galleries tab for a customer without a delivered gallery', () => {
    expect(hrefs(false)).not.toContain('/account/galleries');
    expect(hrefs(false)).toEqual([
      '/account',
      '/account/bookings',
      '/account/notifications',
      '/account/cards',
      '/account/privacy',
    ]);
  });

  it('puts Galleries right after Bookings once one is delivered, leaving the rest in order', () => {
    expect(hrefs(true)).toEqual([
      '/account',
      '/account/bookings',
      '/account/galleries',
      '/account/notifications',
      '/account/cards',
      '/account/privacy',
    ]);
  });

  it('marks the current tab on English AND French (/fr) pages', () => {
    // usePathname() reports the prefixed path on the French site; comparing it raw marked no tab as
    // current (and skipped centring it in the mobile strip) for every French visitor.
    expect(isActiveAccountTab('/account/galleries', '/account/galleries')).toBe(true);
    expect(isActiveAccountTab('/fr/account/galleries', '/account/galleries')).toBe(true);
    expect(isActiveAccountTab('/fr/account', '/account')).toBe(true);
    expect(isActiveAccountTab('/fr/account/', '/account')).toBe(true);
    // Only the exact tab, in either language.
    expect(isActiveAccountTab('/fr/account/bookings', '/account')).toBe(false);
    expect(isActiveAccountTab('/account/bookings', '/account/galleries')).toBe(false);
    expect(isActiveAccountTab('/french-riviera', '/account')).toBe(false);
    expect(isActiveAccountTab(null, '/account')).toBe(false);
  });

  it('labels the tab with a string that has a French translation', async () => {
    const { translate } = await import('@/lib/i18n/translate');
    const galleries = accountTabs(true).find((t) => t.href === '/account/galleries');
    expect(galleries?.label).toBe('Galleries');
    expect(translate('fr', 'Galleries')).toBe('Galeries');
  });
});
