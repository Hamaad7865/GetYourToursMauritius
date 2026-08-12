import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { DocumentModel } from '@/lib/documents/model';
import { formatMinor } from '@/lib/documents/money';
import { toWinAnsi, wrapText, fitText } from '@/lib/invoice/pdf';
import { formatMauritiusDate } from '@/lib/invoice/mauritius-time';

/**
 * Edge-safe PDF renderer for a Documents-module document (quote / invoice / proforma / receipt).
 *
 * The layout deliberately matches the booking invoice (`src/lib/invoice/pdf.ts`) so both look like one
 * business, and it reuses that file's encoding + wrapping helpers (`toWinAnsi`, `wrapText`, `fitText`)
 * rather than restating them. What differs is that this renderer is currency-, VAT-mode- and
 * type-aware: the title, the emphasis (Amount Due vs a PAID stamp), and the footer date label all come
 * off the {@link DocumentModel}, which is the single source of truth shared with the on-screen preview.
 *
 * Currency is drawn as `model.symbol` (`Rs` / `EUR` / `US$`) — all WinAnsi-safe; there is no € glyph.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;
const COL_QTY_RIGHT = CONTENT_RIGHT - 110;
const COL_AMOUNT_RIGHT = CONTENT_RIGHT;
const COL_DESC_MAX_WIDTH = COL_QTY_RIGHT - 70 - MARGIN;

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.8, 0.8, 0.84);
const ACCENT = rgb(0.06, 0.45, 0.36);

/** Join address parts, dropping blanks, into one line. */
function addressLine(parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p && p.trim()).join(', ');
}

export async function renderDocumentPdf(model: DocumentModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  // Mutable so a long line table can spill onto a second page.
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const cur = toWinAnsi(model.symbol);
  const amount = (minor: number) => `${cur} ${formatMinor(minor)}`;

  let y = PAGE_HEIGHT - MARGIN;
  const text = (
    value: string,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {},
  ) => {
    page.drawText(toWinAnsi(value), {
      x: opts.x ?? MARGIN,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? font,
      color: opts.color ?? INK,
    });
  };
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
  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 14) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  // 1 + 2. Issuer header (left) + document title (right), same top band.
  const headerTopY = y;
  const b = model.issuer;
  text(b.legalName, { size: 16, font: bold });
  y -= 18;
  const issuerAddress = addressLine([b.street, b.locality, b.region, b.country]);
  if (issuerAddress) {
    text(issuerAddress, { size: 9, color: MUTED });
    y -= 12;
  }
  const ids = [b.brn ? `BRN: ${b.brn}` : '', b.vat ? `VAT: ${b.vat}` : '']
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

  const savedY = y;
  y = headerTopY;
  textRight(model.title, CONTENT_RIGHT, { size: 13, font: bold });
  y -= 16;
  textRight(`No: ${model.number ?? 'DRAFT'}`, CONTENT_RIGHT, { size: 9, color: MUTED });
  y -= 12;
  textRight(`Date: ${formatMauritiusDate(model.issueDate)}`, CONTENT_RIGHT, {
    size: 9,
    color: MUTED,
  });
  y -= 12;
  // A quote shows its validity; an invoice/proforma shows a due date when one is set.
  if (model.type === 'quote' && model.validUntil) {
    textRight(`Valid until: ${formatMauritiusDate(model.validUntil)}`, CONTENT_RIGHT, {
      size: 9,
      color: MUTED,
    });
    y -= 12;
  } else if ((model.type === 'invoice' || model.type === 'proforma') && model.dueDate) {
    textRight(`Due: ${formatMauritiusDate(model.dueDate)}`, CONTENT_RIGHT, {
      size: 9,
      color: MUTED,
    });
    y -= 12;
  }
  y = Math.min(savedY, y) - 22;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 0.75,
    color: RULE,
  });
  y -= 22;

  // 3. Bill to.
  const c = model.client;
  text('BILL TO', { size: 8, font: bold, color: MUTED });
  y -= 14;
  text(fitText(c.name || '', bold, 11, CONTENT_RIGHT - MARGIN), { size: 11, font: bold });
  y -= 13;
  const clientAddress = addressLine([c.street, c.locality, c.region, c.country]);
  if (clientAddress) {
    text(fitText(clientAddress, font, 9, CONTENT_RIGHT - MARGIN), { size: 9, color: MUTED });
    y -= 12;
  }
  const clientIds = [c.brn ? `BRN: ${c.brn}` : '', c.vat ? `VAT: ${c.vat}` : '']
    .filter(Boolean)
    .join('  .  ');
  if (clientIds) {
    text(clientIds, { size: 9, color: MUTED });
    y -= 12;
  }
  if (c.email) {
    text(fitText(c.email, font, 9, CONTENT_RIGHT - MARGIN), { size: 9, color: MUTED });
    y -= 12;
  }
  y -= 8;

  // 4. Client-facing note, if any (wrapped, full).
  if (model.notes && model.notes.trim()) {
    for (const dl of wrapText(model.notes, font, 9.5, CONTENT_RIGHT - MARGIN)) {
      ensureSpace(14);
      text(dl, { size: 9.5, color: INK });
      y -= 12;
    }
    y -= 8;
  }

  // 5. Line-item table header.
  text('Description', { size: 9, font: bold });
  textRight('Qty', COL_QTY_RIGHT, { size: 9, font: bold });
  textRight('Amount', COL_AMOUNT_RIGHT, { size: 9, font: bold });
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 0.75,
    color: RULE,
  });
  y -= 16;

  // 6. Rows — wrapped description; qty + amount aligned to the first visual line.
  for (const line of model.lines) {
    const descLines = wrapText(line.description || '', font, 10, COL_DESC_MAX_WIDTH);
    ensureSpace(descLines.length * 13 + 8);
    textRight(String(line.quantity ?? ''), COL_QTY_RIGHT, { size: 10 });
    textRight(amount(line.lineMinor), COL_AMOUNT_RIGHT, { size: 10 });
    for (const dl of descLines) {
      text(dl, { size: 10 });
      y -= 13;
    }
    y -= 6;
  }

  // Keep the totals + the PAID/terms box together on one page.
  ensureSpace(220);
  y -= 4;
  page.drawLine({
    start: { x: COL_QTY_RIGHT - 40, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 0.5,
    color: RULE,
  });
  y -= 16;

  // 7. Totals.
  if (model.showVat) {
    textRight(`Subtotal (excl. VAT): ${amount(model.subtotalNetMinor)}`, CONTENT_RIGHT, {
      size: 10,
      color: MUTED,
    });
    y -= 14;
    textRight(`VAT ${model.vatRatePct}%: ${amount(model.vatMinor)}`, CONTENT_RIGHT, {
      size: 10,
      color: MUTED,
    });
    y -= 16;
  }
  textRight(`Total: ${amount(model.totalMinor)}`, CONTENT_RIGHT, { size: 12, font: bold });
  y -= 16;
  // Unpaid documents spell out what is owed; a part-paid one shows both figures.
  if (!model.isPaid) {
    if (model.amountPaidMinor > 0) {
      textRight(`Amount paid: ${amount(model.amountPaidMinor)}`, CONTENT_RIGHT, {
        size: 10,
        color: MUTED,
      });
      y -= 14;
    }
    textRight(`Amount Due: ${amount(model.amountDueMinor)}`, CONTENT_RIGHT, {
      size: 11,
      font: bold,
      color: ACCENT,
    });
    y -= 16;
  }
  y -= 16;

  // 8. PAID stamp (receipt / settled) or a payment-terms box (unpaid).
  const boxTop = y;
  if (model.isPaid) {
    const boxHeight = 64;
    page.drawRectangle({
      x: MARGIN,
      y: boxTop - boxHeight,
      width: 230,
      height: boxHeight,
      borderColor: ACCENT,
      borderWidth: 1.5,
    });
    let by = boxTop - 18;
    page.drawText(toWinAnsi('PAID'), {
      x: MARGIN + 12,
      y: by,
      size: 16,
      font: bold,
      color: ACCENT,
    });
    by -= 20;
    page.drawText(toWinAnsi(amount(model.amountPaidMinor)), {
      x: MARGIN + 12,
      y: by,
      size: 10,
      font,
      color: INK,
    });
    by -= 14;
    const payBits = [
      model.paymentMethod ? `by ${model.paymentMethod}` : '',
      model.paidAt ? `on ${formatMauritiusDate(model.paidAt)}` : '',
      model.paymentRef ? `Ref: ${model.paymentRef}` : '',
    ]
      .filter(Boolean)
      .join('  ');
    if (payBits) {
      page.drawText(fitText(payBits, font, 8, 230 - 24), {
        x: MARGIN + 12,
        y: by,
        size: 8,
        font,
        color: MUTED,
      });
    }
    y = boxTop - boxHeight - 30;
  } else {
    const terms =
      model.type === 'quote'
        ? 'This quotation is valid until the date shown above. Prices are subject to availability.'
        : model.dueDate
          ? `Payment due by ${formatMauritiusDate(model.dueDate)}. Please quote the document number with your payment.`
          : 'Payment due on receipt. Please quote the document number with your payment.';
    const boxHeight = 52;
    page.drawRectangle({
      x: MARGIN,
      y: boxTop - boxHeight,
      width: CONTENT_RIGHT - MARGIN,
      height: boxHeight,
      borderColor: RULE,
      borderWidth: 1,
    });
    let by = boxTop - 18;
    page.drawText(toWinAnsi(model.type === 'quote' ? 'TERMS' : 'PAYMENT TERMS'), {
      x: MARGIN + 12,
      y: by,
      size: 8,
      font: bold,
      color: MUTED,
    });
    by -= 16;
    page.drawText(fitText(terms, font, 9, CONTENT_RIGHT - MARGIN - 24), {
      x: MARGIN + 12,
      y: by,
      size: 9,
      font,
      color: INK,
    });
    y = boxTop - boxHeight - 30;
  }

  // 9. Footer.
  if (y < MARGIN + 14) y = MARGIN + 14;
  page.drawText(toWinAnsi(`Thank you for choosing ${b.legalName}.`), {
    x: MARGIN,
    y: MARGIN,
    size: 9,
    font,
    color: MUTED,
  });

  // Classic xref (no object streams) — same AV-false-positive avoidance as the invoice renderer.
  pdf.setTitle(`${model.title} ${model.number ?? 'DRAFT'}`);
  pdf.setAuthor(b.legalName);
  pdf.setSubject(model.title);
  pdf.setProducer('Belle Mare Tours');
  pdf.setCreator('Belle Mare Tours');
  const issued = new Date(model.issueDate || 0);
  pdf.setCreationDate(issued);
  pdf.setModificationDate(issued);

  return pdf.save({ useObjectStreams: false });
}
