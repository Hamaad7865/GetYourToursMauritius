import { escapeHtml } from './booking-confirmation';
import { SITE } from '@/lib/seo/site';

/**
 * Owner alert for a website enquiry (the ContactFloat form, the /contact page form, and the activity
 * InquiryWidget all land here via the `leads` insert trigger).
 *
 * Deliberately NOT localised, unlike review-request.ts: this is an internal alert read by the owner,
 * not by the guest, so it stays in English regardless of the visitor's language.
 *
 * Pure: no I/O, no Date.now()/new Date(). Every interpolated value is visitor-supplied free text
 * landing in an HTML email opened in a normal mail client, so all of it goes through escapeHtml —
 * the same rule booking-confirmation.ts and the owner booking alert follow.
 */

const ACCENT = '#0E8C92';
const INK = '#11201f';
const MUTED = '#5c6b6a';

export interface LeadEnquiryInput {
  name: string;
  /** Packed "email · phone" free text as stored on the lead row. */
  contact: string;
  message?: string | null;
  /** Absolute or site-relative URL of the page the visitor asked from. */
  pageUrl?: string | null;
  activityTitle?: string | null;
  preferredDate?: string | null;
  partySize?: number | null;
  source?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Split the packed `contact` blob back into its parts so each can get its own labelled row. */
function contactParts(contact: string): string[] {
  return contact
    .split('·')
    .map((p) => p.trim())
    .filter(Boolean);
}

/** A crude but sufficient test — the packer joins email and phone with ' · ', nothing else looks like this. */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Phone-ish: mostly digits, with the usual +, spaces, dashes and parens. */
function isPhone(value: string): boolean {
  return /^[+()\d][\s\-().\d]{5,}$/.test(value);
}

/**
 * Subject names the ACTIVITY when there is one — that is the single most useful thing for triaging a
 * phone-screen inbox — then falls back to the page, then to a bare label.
 */
function buildSubject(input: LeadEnquiryInput): string {
  if (input.activityTitle) return `New enquiry — ${input.activityTitle}`;
  const path = input.pageUrl?.trim();
  if (path && path !== '/') return `New enquiry — ${path}`;
  return 'New website enquiry';
}

export function renderLeadEnquiryEmail(input: LeadEnquiryInput): RenderedEmail {
  const subject = buildSubject(input);
  const name = input.name.trim() || 'A visitor';

  // Label/value pairs built ONCE so the plain-text and HTML branches can't drift apart (the owner
  // booking alert follows the same pattern for the same reason).
  const rows: Array<{ label: string; value: string; kind?: 'email' | 'phone' }> = [];
  rows.push({ label: 'From', value: name });
  for (const part of contactParts(input.contact)) {
    if (isEmail(part)) rows.push({ label: 'Email', value: part, kind: 'email' });
    else if (isPhone(part)) rows.push({ label: 'Phone', value: part, kind: 'phone' });
    else rows.push({ label: 'Contact', value: part });
  }
  if (input.activityTitle) rows.push({ label: 'Interested in', value: input.activityTitle });
  if (input.preferredDate) rows.push({ label: 'Preferred date', value: input.preferredDate });
  if (input.partySize != null) {
    rows.push({
      label: 'People',
      value: `${input.partySize} ${input.partySize === 1 ? 'person' : 'people'}`,
    });
  }
  if (input.pageUrl) rows.push({ label: 'Asked from', value: input.pageUrl });

  const message = input.message?.trim() || '';
  const adminUrl = `${SITE.url}/admin/leads`;

  const text = [
    `${name} sent an enquiry from the website.`,
    '',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ...(message ? ['', 'Message:', message] : []),
    '',
    `Open in admin: ${adminUrl}`,
    '',
    'Belle Mare Tours (internal alert)',
  ].join('\n');

  // mailto:/tel: on the reply paths — the whole point of this alert is replying from a phone in one tap.
  const detailRows = rows
    .map((r) => {
      const value = escapeHtml(r.value);
      const cell =
        r.kind === 'email'
          ? `<a href="mailto:${value}" style="color:${ACCENT};text-decoration:none">${value}</a>`
          : r.kind === 'phone'
            ? `<a href="tel:${value.replace(/[\s\-().]/g, '')}" style="color:${ACCENT};text-decoration:none">${value}</a>`
            : value;
      return `<tr><td style="padding:2px 14px 2px 0;color:${MUTED}">${escapeHtml(r.label)}</td><td>${cell}</td></tr>`;
    })
    .join('');

  // white-space:pre-wrap keeps the visitor's own line breaks without ever rendering their markup.
  const messageBlock = message
    ? `<div style="margin:16px 0 0"><div style="color:${MUTED};font-size:13px;margin-bottom:4px">Message</div>
         <div style="white-space:pre-wrap;background:#f5f8f8;border-radius:10px;padding:12px 14px">${escapeHtml(message)}</div>
       </div>`
    : '';

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${INK};line-height:1.5">
      <h2 style="margin:0 0 12px;color:#0B5C63">New website enquiry</h2>
      <p style="margin:0 0 14px">${escapeHtml(name)} sent an enquiry from the website.</p>
      <table style="border-collapse:collapse;font-size:14px" cellpadding="0">
        ${detailRows}
      </table>
      ${messageBlock}
      <p style="margin:16px 0 0"><a href="${adminUrl}" style="background:${ACCENT};color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;display:inline-block">Open in admin</a></p>
    </div>`;

  return { subject, html, text };
}
