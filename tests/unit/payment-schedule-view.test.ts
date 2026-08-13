import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentSchedule, type ScheduleInstallment } from '@/components/booking/PaymentSchedule';

/**
 * The admin drawer's payment-schedule forecast. The operator must see, per date, WHEN the reminder
 * fires (≈3 days before, matching the cron's leadDays), how much it asks for, what is left — plus a
 * "Next reminder" headline and a "Send reminder now" button on each unpaid row. Christophe's real case is
 * the fixture: €616 over five dates, a €308 deposit already settled (covers 2 Sep + €218 of 4 Sep).
 *
 * Rendered with renderToStaticMarkup (the component uses hooks, so it can't be called as a plain
 * function); assertions run on the tag-stripped, whitespace-collapsed text.
 */

function render(
  installments: ScheduleInstallment[] | null,
  onSendReminder?: (seq: number) => Promise<{ emailed: boolean; recipient: string }>,
): string {
  return renderToStaticMarkup(createElement(PaymentSchedule, { installments, onSendReminder }));
}
const asText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CHRISTOPHE: ScheduleInstallment[] = [
  { seq: 0, dueOn: '2026-09-02', label: '2 Sep 2026', amountEur: 90, coveredEur: 90 },
  { seq: 1, dueOn: '2026-09-04', label: '4 Sep 2026', amountEur: 290, coveredEur: 218 },
  { seq: 2, dueOn: '2026-09-06', label: '6 Sep 2026', amountEur: 30, coveredEur: 0 },
  { seq: 3, dueOn: '2026-09-08', label: '8 Sep 2026', amountEur: 170, coveredEur: 0 },
  { seq: 4, dueOn: '2026-09-09', label: '9 Sep 2026', amountEur: 36, coveredEur: 0 },
];

describe('PaymentSchedule forecast', () => {
  it('shows paid-of-total and the next-reminder headline (date, charge, amount left)', () => {
    const text = asText(render(CHRISTOPHE));
    expect(text).toContain('€308.00 of €616.00 paid');
    expect(text).toContain('Next reminder');
    expect(text).toContain('1 Sep 2026'); // 4 Sep − 3 days = the reminder date
    expect(text).toContain('€72.00'); // what that reminder asks for (290 − 218 covered)
    expect(text).toContain('€308.00 left to collect');
  });

  it('lists each unpaid date with when its reminder fires (≈3 days before)', () => {
    const text = asText(render(CHRISTOPHE));
    expect(text).toContain('Reminder emails 1 Sep 2026'); // for 4 Sep
    expect(text).toContain('Reminder emails 3 Sep 2026'); // for 6 Sep
    expect(text).toContain('Reminder emails 5 Sep 2026'); // for 8 Sep
    expect(text).toContain('Reminder emails 6 Sep 2026'); // for 9 Sep
  });

  it('marks the deposit-covered date Paid and shows the still-owed amount on the partial one', () => {
    const text = asText(render(CHRISTOPHE));
    expect(text).toContain('Paid'); // 2 Sep, covered by the deposit
    expect(text).toContain('deposit'); // seq 0 tagged
    expect(text).toContain('€72.00 due'); // 4 Sep shows what is STILL owed, not the full €290
  });

  it('reads "fully paid" and drops the next-reminder headline once nothing is left', () => {
    const text = asText(render(CHRISTOPHE.map((i) => ({ ...i, coveredEur: i.amountEur }))));
    expect(text).toContain('Fully paid');
    expect(text).not.toContain('Next reminder');
  });

  it('shows a "Send reminder now" button on each unpaid row ONLY when a sender is wired', () => {
    const send = async () => ({ emailed: true, recipient: 'x@y.com' });
    const withButton = asText(render(CHRISTOPHE, send));
    expect(withButton).toContain('Send reminder now');
    // Without the callback (e.g. a read-only reuse) no button is offered.
    const noButton = asText(render(CHRISTOPHE));
    expect(noButton).not.toContain('Send reminder now');
  });

  it('renders nothing for a deposit booking (no schedule)', () => {
    expect(render([])).toBe('');
    expect(render(null)).toBe('');
  });
});
