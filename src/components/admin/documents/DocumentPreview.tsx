import type { DocumentModel } from '@/lib/documents/model';
import { formatMinor } from '@/lib/documents/money';

/**
 * The on-screen twin of the PDF. It renders the SAME {@link DocumentModel} that `renderDocumentPdf`
 * draws, so what the operator previews is what the client receives — the numbers cannot diverge,
 * because both are views of `buildDocument`.
 */

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p && String(p).trim()).join(', ');
}

export function DocumentPreview({ model }: { model: DocumentModel }) {
  const amount = (minor: number) => `${model.symbol} ${formatMinor(minor)}`;
  const b = model.issuer;
  const c = model.client;
  const issuerAddress = joinAddress([b.street, b.locality, b.region, b.country]);
  const clientAddress = joinAddress([c.street, c.locality, c.region, c.country]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white shadow-sm">
      <div className="mx-auto max-w-[640px] p-7 text-[13px] text-ink">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[17px] font-extrabold leading-tight">{b.legalName}</div>
            {issuerAddress && (
              <div className="mt-1 text-[11.5px] text-ink-muted">{issuerAddress}</div>
            )}
            <div className="text-[11.5px] text-ink-muted">
              {[b.brn ? `BRN: ${b.brn}` : '', b.vat ? `VAT: ${b.vat}` : '']
                .filter(Boolean)
                .join('  ·  ')}
            </div>
            <div className="text-[11.5px] text-ink-muted">
              {[b.email, b.phone].filter(Boolean).join('  ·  ')}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[15px] font-bold tracking-wide">{model.title}</div>
            <div className="mt-1 text-[11.5px] text-ink-muted">No: {model.number ?? 'DRAFT'}</div>
            <div className="text-[11.5px] text-ink-muted">Date: {fmtDate(model.issueDate)}</div>
            {model.type === 'quote' && model.validUntil && (
              <div className="text-[11.5px] text-ink-muted">
                Valid until: {fmtDate(model.validUntil)}
              </div>
            )}
            {(model.type === 'invoice' || model.type === 'proforma') && model.dueDate && (
              <div className="text-[11.5px] text-ink-muted">Due: {fmtDate(model.dueDate)}</div>
            )}
          </div>
        </div>

        <div className="my-4 border-t border-[#EAEEF0]" />

        {/* Bill to */}
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">Bill to</div>
        <div className="mt-1 text-[14px] font-bold">{c.name || '—'}</div>
        {clientAddress && <div className="text-[11.5px] text-ink-muted">{clientAddress}</div>}
        <div className="text-[11.5px] text-ink-muted">
          {[c.brn ? `BRN: ${c.brn}` : '', c.vat ? `VAT: ${c.vat}` : '', c.email]
            .filter(Boolean)
            .join('  ·  ')}
        </div>

        {model.notes && (
          <p className="mt-4 whitespace-pre-wrap text-[12px] leading-relaxed text-ink/90">
            {model.notes}
          </p>
        )}

        {/* Lines */}
        <table className="mt-5 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-[#E2E7EA] text-[10px] uppercase tracking-wide text-ink-muted">
              <th className="py-1.5 text-left font-bold">Description</th>
              <th className="py-1.5 text-right font-bold">Qty</th>
              <th className="py-1.5 text-right font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {model.lines.length === 0 ? (
              <tr>
                <td className="py-3 text-ink-muted" colSpan={3}>
                  No lines yet.
                </td>
              </tr>
            ) : (
              model.lines.map((line, i) => (
                <tr key={i} className="border-b border-[#F2F4F6] align-top">
                  <td className="py-2 pr-3">{line.description}</td>
                  <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-2 text-right tabular-nums">{amount(line.lineMinor)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 ml-auto w-full max-w-[260px] space-y-1 text-[12.5px]">
          {model.showVat && (
            <>
              <div className="flex justify-between text-ink-muted">
                <span>Subtotal (excl. VAT)</span>
                <span className="tabular-nums">{amount(model.subtotalNetMinor)}</span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>VAT {model.vatRatePct}%</span>
                <span className="tabular-nums">{amount(model.vatMinor)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-[#E2E7EA] pt-1.5 text-[14px] font-extrabold">
            <span>Total</span>
            <span className="tabular-nums">{amount(model.totalMinor)}</span>
          </div>
          {!model.isPaid && (
            <div className="flex justify-between font-bold text-teal-dark">
              <span>Amount due</span>
              <span className="tabular-nums">{amount(model.amountDueMinor)}</span>
            </div>
          )}
        </div>

        {/* Paid stamp / terms */}
        {model.isPaid ? (
          <div className="mt-5 inline-flex flex-col rounded-xl border-2 border-emerald-500/70 px-4 py-2">
            <span className="text-[15px] font-extrabold text-emerald-600">PAID</span>
            <span className="text-[11.5px] text-ink-muted">
              {amount(model.amountPaidMinor)}
              {model.paymentMethod ? ` · ${model.paymentMethod}` : ''}
              {model.paidAt ? ` · ${fmtDate(model.paidAt)}` : ''}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
