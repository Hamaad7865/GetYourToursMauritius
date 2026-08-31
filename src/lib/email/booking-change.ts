import { escapeHtml } from './booking-confirmation';
import { renderChangeSummaryFragment, type ChangeSummaryInput } from './change-summary';
import { translate } from '@/lib/i18n/translate';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';

/**
 * The styled upgrade of the change-flow's bare `booking_changed` text, for the ONE case that must
 * never carry an invoice PDF: a downgrade, the instant it applies, before any refund exists.
 *
 * Money-timing reason this is a separate template rather than a branch inside
 * booking-confirmation.ts: `paid_minor` still reflects the OLD, higher amount until
 * api_record_change_refund actually reverses it — routing this moment through the invoice-with-PDF
 * pipeline would render "Amount paid: €160, Total: €110", a document that makes no sense. This
 * renderer has no invoice concept at all, mirroring pickup.ts's lightweight shell (branded header, no
 * item table, no PDF) rather than booking-confirmation.ts's.
 *
 * Enriched synchronously, payload-only, by enrichBookingChangeNotice — every field it needs is
 * already on the notify_booking_change_applied outbox row, so this never re-queries the database.
 */

const ACCENT = '#0E8C92';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const OPERATOR = 'Belle Mare Tours';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function shell(bodyHtml: string): string {
  return `<!-- ${OPERATOR} tour change -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr>
            <td style="background:${ACCENT};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">
              ${OPERATOR}
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
              ${OPERATOR}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

export interface ChangeAppliedNoticeInput {
  customerName: string;
  ref: string;
  locale?: Locale | string | null;
  summary: Omit<ChangeSummaryInput, 'locale'>;
}

export function renderChangeAppliedNotice(input: ChangeAppliedNoticeInput): RenderedEmail {
  const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const fragment = renderChangeSummaryFragment({ ...input.summary, locale });

  const subject = t('Your {operator} booking {ref} has changed', {
    operator: OPERATOR,
    ref: input.ref,
  });
  const lead = t('Hi {name}, your tour has changed — here is what happened.', {
    name: input.customerName,
  });
  const promise = t(
    "We'll refund the difference to the card you paid with — it usually lands within a few days.",
  );

  const html =
    shell(`              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">${escapeHtml(t('Your tour has changed'))}</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">${escapeHtml(lead)}</p>
              ${fragment.html}
              <p style="margin:0;color:${INK};font-size:14px;line-height:1.5;">${escapeHtml(promise)}</p>`);

  const text = [
    t('Hi {name},', { name: input.customerName }),
    '',
    lead,
    '',
    fragment.text,
    '',
    promise,
  ].join('\n');

  return { subject, html, text };
}
