import { describe, expect, it } from 'vitest';
import { renderLeadEnquiryEmail } from '@/lib/email/lead-enquiry';

/**
 * The owner alert is the ONLY thing that turns a website enquiry into something a human sees — before
 * this, leads sat unread in /admin/leads. So these assertions are about the two ways it could still
 * fail silently: losing the fields that make it actionable, and rendering visitor text as markup.
 */

const base = {
  name: 'Ana Duarte',
  contact: 'ana@example.com · +230 5555 1234',
  message: 'Is the catamaran wheelchair accessible?',
};

describe('renderLeadEnquiryEmail', () => {
  it('names the activity in the subject — the one fact that triages a phone-screen inbox', () => {
    const { subject } = renderLeadEnquiryEmail({
      ...base,
      activityTitle: 'Catamaran Cruise to Ile aux Cerfs',
    });
    expect(subject).toBe('New enquiry — Catamaran Cruise to Ile aux Cerfs');
  });

  it('falls back to the page, then to a bare label, when there is no activity', () => {
    expect(renderLeadEnquiryEmail({ ...base, pageUrl: '/airport-transfers' }).subject).toBe(
      'New enquiry — /airport-transfers',
    );
    expect(renderLeadEnquiryEmail(base).subject).toBe('New website enquiry');
    // '/' is the home page — a subject reading "New enquiry — /" tells the owner nothing.
    expect(renderLeadEnquiryEmail({ ...base, pageUrl: '/' }).subject).toBe('New website enquiry');
  });

  it('splits the packed contact blob into labelled, one-tap reply links', () => {
    const { html, text } = renderLeadEnquiryEmail(base);
    expect(html).toContain('href="mailto:ana@example.com"');
    // The tel: href strips spaces so the dialler gets a number it can actually call.
    expect(html).toContain('href="tel:+23055551234"');
    expect(text).toContain('Email: ana@example.com');
    expect(text).toContain('Phone: +230 5555 1234');
  });

  it('carries the message and the optional trip fields into both bodies', () => {
    const { html, text } = renderLeadEnquiryEmail({
      ...base,
      activityTitle: 'Dolphin Swim',
      preferredDate: '2026-09-14',
      partySize: 4,
    });
    for (const body of [html, text]) {
      expect(body).toContain('Is the catamaran wheelchair accessible?');
      expect(body).toContain('2026-09-14');
      expect(body).toContain('4 people');
    }
  });

  it('says "1 person", not "1 people"', () => {
    expect(renderLeadEnquiryEmail({ ...base, partySize: 1 }).text).toContain('1 person');
  });

  it('omits optional rows entirely rather than printing blanks', () => {
    const { text } = renderLeadEnquiryEmail({ ...base, message: null });
    expect(text).not.toContain('Preferred date');
    expect(text).not.toContain('People');
    expect(text).not.toContain('Message:');
  });

  // The whole payload is unauthenticated public input landing in a mail client.
  it('escapes visitor text instead of rendering it as markup', () => {
    const { html } = renderLeadEnquiryEmail({
      name: '<img src=x onerror=alert(1)>',
      contact: 'evil@example.com',
      message: '<script>alert("xss")</script> & "quoted"',
      activityTitle: '<b>Tour</b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>Tour</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('still addresses the visitor when they left the name blank', () => {
    const { html, text } = renderLeadEnquiryEmail({ ...base, name: '   ' });
    expect(text).toContain('A visitor sent an enquiry');
    expect(html).toContain('A visitor');
  });
});
