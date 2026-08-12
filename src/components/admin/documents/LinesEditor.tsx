'use client';

import { Card, Field, INPUT_CLS, SELECT_CLS, BTN_GHOST } from '@/components/admin/ui';
import { IconPlus } from '@/components/ui/icons';
import { CURRENCY_LABEL, CURRENCY_SYMBOL, formatMinor } from '@/lib/documents/money';
import type { VatMode } from '@/lib/documents/model';
import {
  CURRENCY_OPTIONS,
  VAT_MODE_LABEL,
  documentModelFromForm,
  type DocumentFormValues,
} from './state';

export function LinesEditor({
  form,
  onChange,
}: {
  form: DocumentFormValues;
  onChange: (patch: Partial<DocumentFormValues>) => void;
}) {
  const setLine = (index: number, patch: Partial<DocumentFormValues['lines'][number]>) =>
    onChange({ lines: form.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const addLine = () =>
    onChange({ lines: [...form.lines, { description: '', quantityText: '1', unitText: '' }] });
  const removeLine = (index: number) =>
    onChange({ lines: form.lines.filter((_, i) => i !== index) });

  const symbol = CURRENCY_SYMBOL[form.currency];
  let total: ReturnType<typeof documentModelFromForm> | null = null;
  let error: string | null = null;
  try {
    total = documentModelFromForm(form);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Check the amounts.';
  }
  const money = (minor: number) => `${symbol} ${formatMinor(minor)}`;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Currency & VAT">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Currency">
            <select
              value={form.currency}
              onChange={(e) =>
                onChange({ currency: e.target.value as DocumentFormValues['currency'] })
              }
              className={SELECT_CLS}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="VAT treatment">
            <select
              value={form.vatMode}
              onChange={(e) => onChange({ vatMode: e.target.value as VatMode })}
              className={SELECT_CLS}
            >
              {(['inclusive', 'exclusive', 'none'] as VatMode[]).map((m) => (
                <option key={m} value={m}>
                  {VAT_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          {form.vatMode !== 'none' && (
            <Field label="VAT rate %">
              <input
                type="number"
                min={0}
                max={100}
                value={form.vatRatePctText}
                onChange={(e) => onChange({ vatRatePctText: e.target.value })}
                className={INPUT_CLS}
              />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Lines">
        <div className="flex flex-col gap-2.5">
          <div className="hidden grid-cols-[1fr_72px_140px_36px] gap-2 px-1 text-[11px] font-bold uppercase tracking-wide text-ink-muted sm:grid">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit ({symbol})</span>
            <span />
          </div>
          {form.lines.map((line, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_72px_140px_36px]">
              <input
                value={line.description}
                onChange={(e) => setLine(i, { description: e.target.value })}
                placeholder="Private full day Catamaran cruise"
                aria-label={`Line ${i + 1} description`}
                className={INPUT_CLS}
              />
              <input
                value={line.quantityText}
                onChange={(e) => setLine(i, { quantityText: e.target.value })}
                inputMode="numeric"
                aria-label={`Line ${i + 1} quantity`}
                className={`${INPUT_CLS} sm:text-right`}
              />
              <input
                value={line.unitText}
                onChange={(e) => setLine(i, { unitText: e.target.value })}
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Line ${i + 1} unit amount`}
                className={`${INPUT_CLS} sm:text-right`}
              />
              <button
                type="button"
                onClick={() => removeLine(i)}
                disabled={form.lines.length === 1}
                aria-label={`Remove line ${i + 1}`}
                className="flex h-[42px] items-center justify-center rounded-xl border border-[#E2E7EA] text-ink-muted hover:border-coral hover:text-coral disabled:opacity-40"
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" onClick={addLine} className={`${BTN_GHOST} mt-1 self-start`}>
            <IconPlus width={15} height={15} /> Add line
          </button>
        </div>
      </Card>

      <Card title="Totals">
        {error ? (
          <p className="text-[13px] text-coral">{error}</p>
        ) : total ? (
          <div className="ml-auto w-full max-w-[280px] space-y-1.5 text-[13.5px]">
            {total.showVat && (
              <>
                <div className="flex justify-between text-ink-muted">
                  <span>Subtotal (excl. VAT)</span>
                  <span className="tabular-nums">{money(total.subtotalNetMinor)}</span>
                </div>
                <div className="flex justify-between text-ink-muted">
                  <span>VAT {total.vatRatePct}%</span>
                  <span className="tabular-nums">{money(total.vatMinor)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-[#EEF1F3] pt-1.5 text-[15px] font-extrabold text-ink">
              <span>Total</span>
              <span className="tabular-nums">{money(total.totalMinor)}</span>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
