import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { InvoiceModel } from './model';
import { formatMauritiusDate, formatMauritiusDateTime } from './mauritius-time';
import { translate } from '@/lib/i18n/translate';

/**
 * Edge-safe combined Tax Invoice / Receipt PDF renderer.
 *
 * pdf-lib is PURE JS (no headless browser, no Node `fs`), so this runs on the Cloudflare edge
 * runtime the app deploys to. We lay out a single A4 page with a top->bottom `y` cursor, guarding
 * every optional field so a sparse model (no pickup/dropoff, no payment ref) still renders.
 *
 * Currency is always shown as the CODE (EUR/USD) — Helvetica's WinAnsi encoding can't render the €
 * glyph cleanly, and `drawText` throws on un-encodable characters, so we never emit it.
 *
 * Localised (Task 16) via `model.locale` — a French VAT invoice must say "TVA", so every label here
 * is translated; the figures (amounts, the invoice number, the booking reference) never are.
 */

// A4 portrait, in PostScript points.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.8, 0.8, 0.84);
const ACCENT = rgb(0.06, 0.45, 0.36); // brand-ish green for the PAID stamp

// Line-item column geometry (x offsets from the left margin's content box).
const COL_QTY_RIGHT = CONTENT_RIGHT - 110; // right edge of the centered Qty column
const COL_AMOUNT_RIGHT = CONTENT_RIGHT; // right edge of the Amount column
const COL_DESC_MAX_WIDTH = COL_QTY_RIGHT - 70 - MARGIN; // description column width before Qty

/** WinAnsi (the Helvetica encoding) can't represent every Unicode char; swap the common ones so
 * `drawText` never throws, then drop anything still outside the printable Latin-1 range.
 * Exported so the sibling voucher renderer shares one encoding-safety pass. */
export function toWinAnsi(input: string): string {
  const replaced = (input ?? '')
    .replace(/€/g, 'EUR') // € -> EUR (belt-and-braces; we already pass codes)
    .replace(/[‘’‚‹›]/g, "'") // curly/angle single quotes
    .replace(/[“”„]/g, '"') // curly double quotes
    .replace(/[–—―]/g, '-') // en/em dashes
    .replace(/…/g, '...') // ellipsis
    .replace(/ /g, ' '); // nbsp
  // Strip anything still outside printable Latin-1 (0x20-0xFF) so encoding can't fail.
  return replaced.replace(/[^\x20-\xFF]/g, '');
}

/** 2-decimal amount with comma thousands grouping (`5938 -> "5,938.00"`). MUR figures are 4-6 digits
 * where an ungrouped run misreads at a glance; EUR figures stay small enough that grouping is a
 * no-op, so this is safe to apply to any charge amount. ASCII comma — WinAnsi-safe by construction. */
export function formatGrouped(amount: number): string {
  const [int, frac] = amount.toFixed(2).split('.');
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

/** Truncate to fit `maxWidth` at `size`, appending an ellipsis when clipped. Exported for the voucher. */
export function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const clean = toWinAnsi(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  const ellipsis = '...';
  let lo = 0;
  let hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = clean.slice(0, mid) + ellipsis;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return clean.slice(0, lo) + ellipsis;
}

export async function renderInvoicePdf(model: InvoiceModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const currency = toWinAnsi(model.currency || 'EUR');
  const locale = model.locale;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);

  // Small left-aligned draw helper that advances the shared `y` cursor.
  let y = PAGE_HEIGHT - MARGIN;
  const text = (
    value: string,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    page.drawText(toWinAnsi(value), {
      x: opts.x ?? MARGIN,
      y,
      size,
      font: opts.font ?? font,
      color: opts.color ?? INK,
    });
  };

  // Right-aligned draw at the current `y` (does not advance the cursor itself).
  const textRight = (
    value: string,
    rightX: number,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const clean = toWinAnsi(value);
    page.drawText(clean, {
      x: rightX - f.widthOfTextAtSize(clean, size),
      y,
      size,
      font: f,
      color: opts.color ?? INK,
    });
  };

  // 1 + 2. Business header (left) and document title (right), drawn at the same starting band.
  const headerTopY = y;
  const b = model.business;
  text(b.legalName, { size: 16, font: bold });
  y -= 18;
  const addressLine = [b.street, b.locality, b.region, b.country].filter(Boolean).join(', ');
  if (addressLine) {
    text(addressLine, { size: 9, color: MUTED });
    y -= 12;
  }
  const ids = [b.brn ? `BRN: ${b.brn}` : '', b.vat ? `${t('VAT')}: ${b.vat}` : '']
    .filter(Boolean)
    .join('  .  ');
  if (ids) {
    text(ids, { size: 9, color: MUTED });
    y -= 12;
  }
  const contact = [b.email, b.phone].filter(Boolean).join('  .  ');
  if (contact) {
    text(contact, { size: 9, color: MUTED });
    y -= 12;
  }

  // Document title block, right-aligned, anchored to the header's top band.
  const savedY = y;
  y = headerTopY;
  // A part-paid booking (balance still owed) is a PAYMENT RECEIPT, not a TAX INVOICE — the full VAT
  // invoice is issued once the balance clears. A fully-paid booking is byte-identical to before.
  textRight(
    t(model.balanceDueEur > 0 ? 'PAYMENT RECEIPT' : 'TAX INVOICE / RECEIPT'),
    CONTENT_RIGHT,
    {
      size: 13,
      font: bold,
    },
  );
  y -= 16;
  textRight(`${t('Invoice No')}: ${model.invoiceNumber}`, CONTENT_RIGHT, { size: 9, color: MUTED });
  y -= 12;
  textRight(`${t('Date')}: ${formatMauritiusDate(model.issuedAt)}`, CONTENT_RIGHT, {
    size: 9,
    color: MUTED,
  });
  // Resume below whichever block (left header / right title) ended lower.
  y = Math.min(savedY, y) - 22;

  // Horizontal divider under the header.
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 0.75,
    color: RULE,
  });
  y -= 22;

  // 3. Bill to.
  text(t('BILL TO'), { size: 8, font: bold, color: MUTED });
  y -= 14;
  text(model.customer.name || '', { size: 11, font: bold });
  y -= 13;
  if (model.customer.email) {
    text(model.customer.email, { size: 9, color: MUTED });
    y -= 13;
  }
  y -= 6;

  // 4. Trip block.
  const trip = model.booking;
  text(t('BOOKING'), { size: 8, font: bold, color: MUTED });
  y -= 14;
  text(`${t('Booking')}: ${trip.ref}`, { size: 10 });
  y -= 13;
  text(fitText(trip.activityTitle || '', font, 10, CONTENT_RIGHT - MARGIN), { size: 10 });
  y -= 13;
  if (trip.when) {
    text(`${t('Date')}: ${formatMauritiusDateTime(trip.when)}`, { size: 10, color: MUTED });
    y -= 13;
  }
  if (trip.pickup) {
    text(fitText(`${t('Pick-up')}: ${trip.pickup}`, font, 10, CONTENT_RIGHT - MARGIN), {
      size: 10,
      color: MUTED,
    });
    y -= 13;
  }
  if (trip.dropoff) {
    text(fitText(`${t('Drop-off')}: ${trip.dropoff}`, font, 10, CONTENT_RIGHT - MARGIN), {
      size: 10,
      color: MUTED,
    });
    y -= 13;
  }
  y -= 10;

  // 4b. Transfer details block (airport transfers only) — the driver's run-sheet data.
  const tr = trip.transfer;
  if (tr) {
    const directionLabel =
      tr.direction === 'departure'
        ? t('Departure (hotel to airport)')
        : tr.direction === 'return'
          ? t('Return (both ways)')
          : t('Arrival (airport to hotel)');
    const rows: string[] = [`${t('Trip')}: ${directionLabel}`];
    if (tr.roomOrCabin) rows.push(`${t('Room/cabin')}: ${tr.roomOrCabin}`);
    if (tr.flightNumber || tr.arrivalTime) {
      rows.push(
        `${t('Arrival')}: ${[tr.flightNumber, tr.arrivalTime].filter(Boolean).join(' at ')}`,
      );
    }
    if (tr.departureFlightNumber || tr.returnDate || tr.returnTime) {
      const dep = [
        tr.departureFlightNumber,
        [tr.returnDate, tr.returnTime].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(' · ');
      rows.push(`${t('Departure')}: ${dep}`);
    }
    if (tr.luggageDetails) rows.push(`${t('Luggage')}: ${tr.luggageDetails}`);
    if (typeof tr.childSeatAge === 'number')
      rows.push(`${t('Child seat — age')}: ${tr.childSeatAge}`);
    if (tr.travellerCountry) rows.push(`${t('Country')}: ${tr.travellerCountry}`);
    if (tr.travellerCompany) rows.push(`${t('Company')}: ${tr.travellerCompany}`);
    if (tr.travellerGender) rows.push(`${t('Gender')}: ${tr.travellerGender}`);
    if (tr.specialNotes) rows.push(`${t('Notes')}: ${tr.specialNotes}`);

    text(t('TRANSFER DETAILS'), { size: 8, font: bold, color: MUTED });
    y -= 14;
    for (const row of rows) {
      text(fitText(row, font, 10, CONTENT_RIGHT - MARGIN), { size: 10, color: MUTED });
      y -= 13;
    }
    y -= 10;
  }

  // 5. Line-item table header.
  text(t('Description'), { size: 9, font: bold });
  textRight(t('Qty'), COL_QTY_RIGHT, { size: 9, font: bold });
  textRight(t('Amount'), COL_AMOUNT_RIGHT, { size: 9, font: bold });
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 0.75,
    color: RULE,
  });
  y -= 16;

  // Line-item rows.
  for (const line of model.lines) {
    text(fitText(line.description, font, 10, COL_DESC_MAX_WIDTH), { size: 10 });
    textRight(String(line.quantity ?? ''), COL_QTY_RIGHT, { size: 10 });
    textRight(`${currency} ${line.lineGrossEur.toFixed(2)}`, COL_AMOUNT_RIGHT, { size: 10 });
    y -= 15;
  }

  y -= 4;
  page.drawLine({
    start: { x: COL_QTY_RIGHT - 40, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 0.5,
    color: RULE,
  });
  y -= 16;

  // 6. Totals (right-aligned).
  textRight(
    `${t('Subtotal (excl. VAT)')}: ${currency} ${model.subtotalNetEur.toFixed(2)}`,
    CONTENT_RIGHT,
    {
      size: 10,
      color: MUTED,
    },
  );
  y -= 14;
  textRight(
    `${t('VAT')} ${model.vatRatePct}%: ${currency} ${model.vatAmountEur.toFixed(2)}`,
    CONTENT_RIGHT,
    {
      size: 10,
      color: MUTED,
    },
  );
  y -= 16;
  textRight(`${t('Total')}: ${currency} ${model.totalGrossEur.toFixed(2)}`, CONTENT_RIGHT, {
    size: 12,
    font: bold,
  });
  y -= 14;
  // The deposit split (Task 6/7): when a balance is still owed, spell out what has settled and what is
  // left, right under the order Total. Absent (balanceDue = 0) for every fully-paid booking, so an
  // ordinary invoice is unchanged.
  if (model.balanceDueEur > 0) {
    textRight(`${t('Amount paid')}: ${currency} ${model.amountPaidEur.toFixed(2)}`, CONTENT_RIGHT, {
      size: 11,
      font: bold,
      color: ACCENT,
    });
    y -= 14;
    textRight(`${t('Balance due')}: ${currency} ${model.balanceDueEur.toFixed(2)}`, CONTENT_RIGHT, {
      size: 11,
      font: bold,
    });
    y -= 14;
  }
  // Cross-currency charge disclosure (MUR since 2026-07-30) — in the TOTALS block, not the PAID box
  // (whose 64pt height is fully consumed; a fourth line would render outside its border). The rate
  // printed is the EFFECTIVE one (chargedAmount / total), so the document's own arithmetic closes.
  // EUR-era documents (isConverted false) render byte-identically to before.
  if (model.payment?.isConverted) {
    const rate = model.payment.fxRate;
    textRight(
      `${t('Charged to card')}: ${toWinAnsi(model.payment.chargedCurrency)} ${formatGrouped(
        model.payment.chargedAmount,
      )}${rate != null ? ` (1 ${currency} = ${rate.toFixed(4)} ${toWinAnsi(model.payment.chargedCurrency)})` : ''}`,
      CONTENT_RIGHT,
      { size: 9, color: MUTED },
    );
    y -= 16;
  }
  y -= 16;

  // 7. PAID stamp — a bordered box on the left. A part-paid booking is stamped DEPOSIT PAID (the box
  // shows the deposit that WAS charged); the amount still owed is spelled out in the totals block above.
  const pay = model.payment;
  const paidInFull = model.balanceDueEur <= 0;
  const boxX = MARGIN;
  const boxTop = y;
  const boxWidth = 230;
  const boxHeight = 64;
  page.drawRectangle({
    x: boxX,
    y: boxTop - boxHeight,
    width: boxWidth,
    height: boxHeight,
    borderColor: ACCENT,
    borderWidth: 1.5,
  });
  // Draw the box's contents with a local cursor so the outer `y` math stays simple.
  let by = boxTop - 18;
  page.drawText(toWinAnsi(paidInFull ? t('PAID') : t('DEPOSIT PAID')), {
    x: boxX + 12,
    y: by,
    size: 16,
    font: bold,
    color: ACCENT,
  });
  const chargeParts: string[] = [];
  if (pay && typeof pay.chargedAmount === 'number') {
    chargeParts.push(
      `${toWinAnsi(pay.chargedCurrency || currency)} ${formatGrouped(pay.chargedAmount)}`,
    );
  }
  if (pay?.paidAt) chargeParts.push(t('on {date}', { date: formatMauritiusDate(pay.paidAt) }));
  by -= 20;
  if (chargeParts.length) {
    page.drawText(fitText(chargeParts.join('  '), font, 10, boxWidth - 24), {
      x: boxX + 12,
      y: by,
      size: 10,
      font,
      color: INK,
    });
    by -= 14;
  }
  if (pay?.providerRef) {
    page.drawText(fitText(`${t('Ref')}: ${pay.providerRef}`, font, 8, boxWidth - 24), {
      x: boxX + 12,
      y: by,
      size: 8,
      font,
      color: MUTED,
    });
  }
  y = boxTop - boxHeight - 30;

  // 8. Footer.
  if (y < MARGIN + 14) y = MARGIN + 14; // never let the footer fall off the page
  page.drawText(toWinAnsi(t('Thank you for booking with {name}.', { name: b.legalName })), {
    x: MARGIN,
    y: MARGIN,
    size: 9,
    font,
    color: MUTED,
  });

  // Complete metadata + a CLASSIC cross-reference table (no compressed object streams). pdf-lib's default
  // /ObjStm + /XRef stream structure on a freshly-generated, zero-reputation file is a heuristic-AV
  // false-positive trigger; the receipt has no active content, so the plain structure scans cleanly.
  // Dates pinned to the issue date keep the bytes reproducible (no wall clock). See voucher-pdf.ts.
  const issued = new Date(model.issuedAt || 0);
  pdf.setTitle(`Invoice ${model.invoiceNumber}`);
  pdf.setAuthor(b.legalName);
  pdf.setSubject('Tax invoice / receipt');
  pdf.setProducer('Belle Mare Tours');
  pdf.setCreator('Belle Mare Tours');
  pdf.setCreationDate(issued);
  pdf.setModificationDate(issued);

  return pdf.save({ useObjectStreams: false });
}
