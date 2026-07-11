import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import type { InvoiceModel } from './model';
import { formatMauritiusDate, formatMauritiusDateTime } from './mauritius-time';
import { toWinAnsi, fitText } from './pdf';
import { transferLegs } from '@/lib/transfers/leg-times';

/**
 * Edge-safe airport-transfer E-VOUCHER renderer (pdf-lib, pure JS — no headless browser, no Node fs),
 * a sibling of the tax-invoice renderer in `pdf.ts`. This is the OPERATIONAL document the traveller
 * shows the driver and the driver uses as a run-sheet: it leads with how you'll be met, the trip
 * details and a scannable booking QR — the price is a single secondary line and the VAT receipt is a
 * separate attachment. Only ever rendered for bookings with `model.booking.transfer` set.
 *
 * Currency renders as the CODE (EUR/USD): Helvetica's WinAnsi encoding can't draw the € glyph and
 * `drawText` throws on un-encodable chars, so `toWinAnsi` (shared with pdf.ts) guards every string.
 * English-only, like the receipt/email layer — the lingua franca for an airport meeting point.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;
const HEADER_H = 122;

const TEAL_DARK = rgb(0.043, 0.361, 0.388); // #0B5C63
const GOLD = rgb(0.914, 0.725, 0.286); // #E9B949
const CORAL = rgb(0.969, 0.424, 0.369); // #F76C5E
const INK = rgb(0.067, 0.125, 0.122); // #11201F
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);
const LIGHT_TEAL = rgb(0.624, 0.882, 0.796); // #9FE1CB
const WHITE = rgb(1, 1, 1);

const BRAND_NAME = 'GetYourToursMauritius';
const FIELD_X = MARGIN + 104; // where run-sheet values start (labels sit at MARGIN)

function directionLabel(d?: string | null): string {
  if (d === 'departure') return 'Departure — hotel to airport';
  if (d === 'return') return 'Return — both directions';
  return 'Arrival — airport to hotel';
}

/** "2026-06-28" → "28 Jun 2026". UTC-pinned so the rendered PDF stays deterministic across servers. */
function fmtLegDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Greedy word-wrap to fit `maxWidth`, returning the lines (each already WinAnsi-safe). */
function wrapText(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = toWinAnsi(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) cur = test;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draw a QR for `data` as filled modules, top-left at (x, yTop), fitting a `size`-pt square. */
function drawQr(page: PDFPage, data: string, x: number, yTop: number, size: number): void {
  const qr = qrcode(0, 'M');
  // encodeURI keeps the payload ASCII so the lib's 8-bit byte mode can't mangle a non-ASCII char.
  qr.addData(encodeURI(data));
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 2; // modules of white margin so scanners lock on
  const cell = size / (count + quiet * 2);
  page.drawRectangle({ x, y: yTop - size, width: size, height: size, color: WHITE });
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (!qr.isDark(r, c)) continue;
      page.drawRectangle({
        x: x + (c + quiet) * cell,
        y: yTop - (r + quiet + 1) * cell,
        // Slight overdraw closes the hairline seams anti-aliasing leaves between cells.
        width: cell + 0.4,
        height: cell + 0.4,
        color: INK,
      });
    }
  }
}

export async function renderVoucherPdf(
  model: InvoiceModel,
  bookingUrl: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const currency = toWinAnsi(model.currency || 'EUR');
  const tr = model.booking.transfer ?? null;
  const b = model.business;

  const draw = (
    value: string,
    y: number,
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
  const drawRight = (
    value: string,
    rightX: number,
    y: number,
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

  // ── 1. Brand header band ───────────────────────────────────────────────────
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - HEADER_H,
    width: PAGE_WIDTH,
    height: HEADER_H,
    color: TEAL_DARK,
  });
  const bandTop = PAGE_HEIGHT - 44;
  draw(BRAND_NAME, bandTop, { size: 17, font: bold, color: WHITE });
  draw(b.legalName, bandTop - 17, { size: 9.5, color: LIGHT_TEAL });
  draw('Licensed - Mauritius Tourism Authority', bandTop - 33, { size: 9.5, color: GOLD });

  drawRight('AIRPORT TRANSFER - E-VOUCHER', CONTENT_RIGHT, bandTop, {
    size: 9.5,
    font: bold,
    color: LIGHT_TEAL,
  });
  drawRight(model.booking.ref, CONTENT_RIGHT, bandTop - 22, { size: 19, font: bold, color: WHITE });
  drawRight('CONFIRMED - PAID', CONTENT_RIGHT, bandTop - 38, {
    size: 9.5,
    font: bold,
    color: GOLD,
  });

  // ── 2. Show-to-driver row + booking QR ─────────────────────────────────────
  let y = PAGE_HEIGHT - HEADER_H - 30;
  const qrSize = 96;
  const qrX = CONTENT_RIGHT - qrSize;
  drawQr(page, bookingUrl, qrX, y + 6, qrSize);
  drawRight('Scan to view booking', CONTENT_RIGHT, y + 6 - qrSize - 11, {
    size: 7.5,
    color: MUTED,
  });

  const textRightEdge = qrX - 18;
  draw('Show this voucher to your driver', y, { size: 13, font: bold });
  y -= 17;
  const intro =
    'Your driver-guide meets you in the Arrivals hall holding a name board with your name. We track your ' +
    'flight in real time and waiting time is free, so a late landing never leaves you stranded.';
  for (const line of wrapText(intro, font, 9.5, textRightEdge - MARGIN)) {
    draw(line, y, { size: 9.5, color: MUTED });
    y -= 13;
  }
  y = Math.min(y, PAGE_HEIGHT - HEADER_H - 30 - qrSize - 26) - 8;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 0.75,
    color: RULE,
  });
  y -= 24;

  // ── 3. Run-sheet ───────────────────────────────────────────────────────────
  draw('YOUR TRIP', y, { size: 8.5, font: bold, color: TEAL_DARK });
  page.drawRectangle({ x: MARGIN, y: y - 6, width: 30, height: 2, color: GOLD });
  y -= 20;

  // Values render verbatim (DB content), bounded to `maxLines` so a long note / hotel name can't push the
  // price band and the fixed-y footer off the page; an over-long value is ellipsised on its last line.
  const valW = CONTENT_RIGHT - FIELD_X;
  const field = (label: string, value: string, maxLines = 1) => {
    draw(label, y, { size: 9.5, color: MUTED });
    let lines =
      maxLines <= 1 ? [fitText(value, font, 10.5, valW)] : wrapText(value, font, 10.5, valW);
    if (lines.length > maxLines) {
      const last = lines[maxLines - 1] ?? '';
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = fitText(`${last} ...`, font, 10.5, valW);
    }
    lines.forEach((line, i) => {
      draw(line, y, { size: 10.5, font: i === 0 ? bold : font, x: FIELD_X });
      if (i < lines.length - 1) y -= 13;
    });
    y -= 17;
  };

  const pax = model.lines[0]?.quantity ?? null;
  const passenger = [model.customer.name, pax ? `${pax} passenger${pax === 1 ? '' : 's'}` : '']
    .filter(Boolean)
    .join(' - ');
  if (passenger) field('Passenger', passenger);
  field('Direction', directionLabel(tr?.direction));
  if (model.booking.pickup) field('Pick-up', model.booking.pickup);
  if (model.booking.dropoff) field('Drop-off', model.booking.dropoff);
  if (tr?.roomOrCabin) field('Room / cabin', tr.roomOrCabin);

  // Each leg as pickup date·time (+ flight) and an APPROX drop-off (pickup + the ~60-min drive). The hotel
  // drop-off time isn't booked, hence the "~" / "approx". The arrival/inbound date comes from booking.when.
  const legs = transferLegs({
    direction: tr?.direction,
    serviceDateIso: model.booking.when,
    arrivalTime: tr?.arrivalTime,
    returnDate: tr?.returnDate,
    returnTime: tr?.returnTime,
  });
  if (legs.length) {
    for (const leg of legs) {
      const flight = leg.kind === 'arrival' ? tr?.flightNumber : tr?.departureFlightNumber;
      field(
        leg.kind === 'arrival' ? 'Arrival' : 'Departure',
        [`${fmtLegDate(leg.pickupYmd)} at ${leg.pickupTime}`, flight ? `flight ${flight}` : '']
          .filter(Boolean)
          .join('  -  '),
      );
      if (leg.dropoffYmd && leg.dropoffTime) {
        field('Drop-off (approx.)', `${fmtLegDate(leg.dropoffYmd)} at ~${leg.dropoffTime}`);
      }
    }
  } else {
    const arrival = [tr?.flightNumber, tr?.arrivalTime].filter(Boolean).join(' at ');
    if (arrival) field('Arrival flight', arrival);
    const departure = [
      tr?.departureFlightNumber,
      [tr?.returnDate, tr?.returnTime].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(' - ');
    if (departure) field('Departure flight', departure);
  }

  if (tr?.luggageDetails) field('Luggage', tr.luggageDetails, 2);
  if (typeof tr?.childSeatAge === 'number') field('Child seat', `1 seat - age ${tr.childSeatAge}`);
  if (tr?.travellerCountry) field('Country', tr.travellerCountry);
  if (tr?.specialNotes) field('Notes', tr.specialNotes, 4);

  y -= 4;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 0.5,
    color: RULE,
  });
  y -= 22;

  // ── 4. Driver contact ──────────────────────────────────────────────────────
  draw('YOUR DRIVER & 24/7 HELP', y, { size: 8.5, font: bold, color: TEAL_DARK });
  y -= 18;
  for (const line of wrapText(
    `Your driver's name and direct number are sent to you by WhatsApp 24 hours before pick-up. ` +
      `Can't find your driver at the airport? Call or WhatsApp our 24/7 dispatch.`,
    font,
    10,
    CONTENT_RIGHT - MARGIN,
  )) {
    draw(line, y, { size: 10, color: MUTED });
    y -= 14;
  }
  draw(`Dispatch & WhatsApp: ${b.phone}`, y, { size: 11, font: bold, color: INK });
  y -= 24;

  // ── 5. Price (secondary) + cancellation ────────────────────────────────────
  // Floor the price band so it (and the fixed-y footer) can never collide, even if the run-sheet ran long.
  if (y < MARGIN + 96) y = MARGIN + 96;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 0.5,
    color: RULE,
  });
  y -= 20;
  draw('Total paid', y, { size: 9.5, color: MUTED });
  drawRight(`${currency} ${model.totalGrossEur.toFixed(2)}`, CONTENT_RIGHT, y, {
    size: 13,
    font: bold,
    color: TEAL_DARK,
  });
  y -= 15;
  draw(
    `Includes VAT (${model.vatRatePct}%) ${currency} ${model.vatAmountEur.toFixed(2)}. A full tax receipt is attached to your confirmation email.`,
    y,
    { size: 9, color: MUTED },
  );
  y -= 16;
  draw('Free cancellation up to 24 hours before pick-up.', y, {
    size: 9.5,
    font: bold,
    color: CORAL,
  });

  // ── 6. Footer ──────────────────────────────────────────────────────────────
  const footY = MARGIN;
  const issued = model.issuedAt ? formatMauritiusDate(model.issuedAt) : '';
  const footer = [
    `${b.legalName}  -  BRN ${b.brn}  -  VAT ${b.vat}  -  ${b.email}`,
    issued ? `Issued ${issued}` : '',
  ]
    .filter(Boolean)
    .join('     ');
  draw(fitText(footer, font, 8.5, CONTENT_RIGHT - MARGIN), footY, { size: 8.5, color: MUTED });

  // Complete, deterministic document metadata — pinned to the booking, never the wall clock. pdf-lib's
  // create() stamps CreationDate/ModDate from `new Date()`; overwriting them from model.issuedAt is what
  // keeps the saved bytes reproducible (this pdf-lib version's save() serializes these, doesn't re-stamp).
  const stamp = new Date(model.issuedAt || model.booking.when || 0);
  pdf.setTitle(`E-Voucher ${model.booking.ref}`);
  pdf.setAuthor(b.legalName);
  pdf.setSubject(
    model.booking.when
      ? `Transfer ${formatMauritiusDateTime(model.booking.when)}`
      : 'Airport transfer',
  );
  pdf.setKeywords(['airport transfer', 'e-voucher', model.booking.ref]);
  pdf.setProducer('GetYourToursMauritius');
  pdf.setCreator('GetYourToursMauritius');
  pdf.setCreationDate(stamp);
  pdf.setModificationDate(stamp);

  // Emit a CLASSIC cross-reference table (no compressed object streams). pdf-lib's default packs the
  // document into a /ObjStm + /XRef stream; that compressed structure on a brand-new, zero-reputation file
  // is a notorious heuristic-AV false-positive trigger (e.g. McAfee). The voucher has NO active content —
  // no JavaScript, no embedded files, no OpenAction — so a plain, uncompressed structure scans cleanly.
  return pdf.save({ useObjectStreams: false });
}
