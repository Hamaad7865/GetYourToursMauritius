import { describe, expect, it } from 'vitest';
import { mailtoHref, telHref, whatsappChatHref, whatsappNumber } from '@/lib/admin/contact-links';
import { whatsappNumber as quotesWhatsappNumber } from '@/components/admin/quotes/whatsapp';

/* One rule for turning a guest's stored email and phone into links, on Bookings, the Calendar, the
 * enquiries inbox and the quotes worklist. */

describe('mailtoHref', () => {
  it('links exactly one address', () => {
    expect(mailtoHref('marie@example.com')).toBe('mailto:marie@example.com');
    expect(mailtoHref('  marie@example.com ')).toBe('mailto:marie@example.com');
  });

  it('never links free text that could pre-fill a message', () => {
    expect(mailtoHref('a@b.com?cc=x@y.com&body=hi')).toBeNull();
    expect(mailtoHref('a@b.com, c@d.com')).toBeNull();
    expect(mailtoHref('call me on 5772 9919')).toBeNull();
    expect(mailtoHref('')).toBeNull();
    expect(mailtoHref(null)).toBeNull();
  });
});

describe('whatsappChatHref', () => {
  it('opens a chat only when the number carries its country code', () => {
    expect(whatsappChatHref('+33 6 12 34 56 78')).toBe('https://wa.me/33612345678');
    expect(whatsappChatHref('0044 7700 900123')).toBe('https://wa.me/447700900123');
    expect(whatsappChatHref('+44 (0)7700 900123')).toBe('https://wa.me/447700900123');
  });

  it('never guesses a country code', () => {
    expect(whatsappChatHref('5772 9919')).toBeNull();
    expect(whatsappChatHref('0612345678')).toBeNull();
    expect(whatsappChatHref('+33 6 12 ext 4')).toBeNull();
    expect(whatsappChatHref('')).toBeNull();
    expect(whatsappChatHref(null)).toBeNull();
  });

  it('carries no message — nothing with a link or token goes into the URL', () => {
    expect(whatsappChatHref('+230 5772 9919')).not.toContain('?');
  });

  it('is the same number rule the quotes screen sends with', () => {
    expect(quotesWhatsappNumber).toBe(whatsappNumber);
  });
});

describe('telHref', () => {
  it('drops the spaces and nothing else', () => {
    expect(telHref('+230 5772 9919')).toBe('tel:+23057729919');
    expect(telHref(null)).toBeNull();
    expect(telHref('   ')).toBeNull();
  });
});
