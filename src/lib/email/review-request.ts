import { escapeHtml } from './booking-confirmation';

/**
 * Post-trip review-request email. Mirrors booking-confirmation.ts's email-safe construction
 * (inline styles only, table layout, ~600px width). The two buttons are ALWAYS both present and
 * identically worded — this feature must never branch on a rating to decide whether the Google
 * button appears (Google's anti-gating policy; see the design spec §2e). No I/O, no Date.now().
 */

const ACCENT = '#0E8C92';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

export interface ReviewRequestInput {
  customerName: string;
  activityTitle: string;
  siteReviewUrl: string;
  googleReviewUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function button(href: string, label: string): string {
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;margin:0 8px 8px 0;">
                <tr>
                  <td style="border-radius:6px;background:${ACCENT};">
                    <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
                  </td>
                </tr>
              </table>`;
}

export function renderReviewRequestEmail(input: ReviewRequestInput): RenderedEmail {
  const operator = 'Belle Mare Tours';
  const activity = escapeHtml(input.activityTitle);
  const name = escapeHtml(input.customerName);

  const subject = `How was your ${input.activityTitle}?`;

  const html = `<!-- ${operator} review request -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr>
            <td style="background:${ACCENT};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">
              ${operator}
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">How was your ${activity}?</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">
                Hi ${name}, thanks for touring with us. If you have a minute, we'd love to hear how it went — it helps other travellers find us too.
              </p>
              ${button(input.siteReviewUrl, 'Review us on our site')}
              ${button(input.googleReviewUrl, 'Review us on Google')}
              <p style="margin:20px 0 0 0;color:${MUTED};font-size:13px;line-height:1.6;">
                Thanks again for choosing ${operator}.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
              ${operator}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;

  const text = [
    `Hi ${input.customerName},`,
    '',
    `How was your ${input.activityTitle}? If you have a minute, we'd love to hear how it went.`,
    '',
    `Review us on our site: ${input.siteReviewUrl}`,
    `Review us on Google: ${input.googleReviewUrl}`,
    '',
    `Thanks again for choosing ${operator}.`,
  ].join('\n');

  return { subject, html, text };
}
