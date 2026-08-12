'use client';

import { Card, Field, INPUT_CLS, TEXTAREA_CLS } from '@/components/admin/ui';
import { CURRENCY_SYMBOL } from '@/lib/documents/money';
import type { DocumentFormValues } from './state';
import { DatePicker } from '@/components/ui/DatePicker';

export function DetailsPane({
  form,
  onChange,
}: {
  form: DocumentFormValues;
  onChange: (patch: Partial<DocumentFormValues>) => void;
}) {
  const isQuote = form.type === 'quote';
  const isReceipt = form.type === 'receipt';
  const showPayment = form.type !== 'quote';
  const symbol = CURRENCY_SYMBOL[form.currency];

  return (
    <div className="flex flex-col gap-4">
      <Card title="Dates">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issue date">
            <DatePicker
              value={form.issueDate}
              onChange={(v) => onChange({ issueDate: v })}
              className={INPUT_CLS}
            />
          </Field>
          {isQuote ? (
            <Field label="Valid until" hint="Shown on the quotation as its validity date.">
              <DatePicker
                value={form.validUntil}
                onChange={(v) => onChange({ validUntil: v })}
                className={INPUT_CLS}
              />
            </Field>
          ) : !isReceipt ? (
            <Field
              label="Payment due by"
              hint="Shown on the invoice; leave blank for 'due on receipt'."
            >
              <DatePicker
                value={form.dueDate}
                onChange={(v) => onChange({ dueDate: v })}
                className={INPUT_CLS}
              />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card title="Notes">
        <Field label="Covering note — the client reads this">
          <textarea
            value={form.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            rows={4}
            placeholder="As agreed — a private full-day catamaran cruise to the three northern islands."
            className={TEXTAREA_CLS}
          />
        </Field>
        <div className="mt-4">
          <Field
            label="Internal note — never printed"
            hint="Staff only; it is not rendered on the document."
          >
            <textarea
              value={form.internalNotes}
              onChange={(e) => onChange({ internalNotes: e.target.value })}
              rows={3}
              placeholder="Corporate client — net 14 days, chase accounts if unpaid."
              className={TEXTAREA_CLS}
            />
          </Field>
        </div>
      </Card>

      {showPayment && (
        <Card title={isReceipt ? 'Payment received' : 'Record a payment (optional)'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`Amount paid (${symbol})`}
              hint={isReceipt ? 'Blank = the full total.' : undefined}
            >
              <input
                value={form.amountPaidText}
                onChange={(e) => onChange({ amountPaidText: e.target.value })}
                inputMode="decimal"
                placeholder="0.00"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Paid on">
              <DatePicker
                value={form.paidAt}
                onChange={(v) => onChange({ paidAt: v })}
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Method">
              <input
                value={form.paymentMethod}
                onChange={(e) => onChange({ paymentMethod: e.target.value })}
                placeholder="Bank transfer / Cash / Card / Cheque"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Reference">
              <input
                value={form.paymentRef}
                onChange={(e) => onChange({ paymentRef: e.target.value })}
                placeholder="MCB txn 12345"
                className={INPUT_CLS}
              />
            </Field>
          </div>
          {!isReceipt && (
            <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
              Recording a payment marks the invoice paid (or part-paid) and shows a PAID stamp once
              the amount covers the total. Leave it blank for an unpaid invoice.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
