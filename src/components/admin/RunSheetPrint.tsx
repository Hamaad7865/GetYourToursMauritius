'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { buttonClass } from '@/components/admin/ui';
import { PickupText } from '@/components/admin/PickupText';
import { IconDocument } from '@/components/ui/icons';
import type { DayEntry } from '@/lib/admin/calendar';
import { runSheet, type RunSheet } from '@/lib/admin/run-sheet';

/**
 * "Print run sheet": one day on A4, for the driver and the guide (back-office redesign, phase 2).
 *
 * The sheet is built by `runSheet` (src/lib/admin/run-sheet.ts) from the day-sheet entries the
 * caller already holds — the same `loadDaySchedule`/`loadCalendarRange` rows the Calendar draws — and
 * printed with the browser's own `window.print()`. No route, no PDF library, nothing sent anywhere.
 *
 * While printing, the sheet is mounted straight under <body> and `bmt-printing` is set on <html>;
 * the print rules in app/globals.css then hide everything else and lay the sheet out black on white,
 * readable without colour. It unmounts after the print dialog closes.
 */
export function PrintRunSheetButton({
  entries,
  day,
  today,
  showMoney,
  label = 'Print run sheet',
  disabled = false,
}: {
  entries: readonly DayEntry[] | null;
  day: string;
  today: string;
  /** Prints payment only for someone who sees money on the day sheet. */
  showMoney: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const [sheet, setSheet] = useState<RunSheet | null>(null);

  useEffect(() => {
    if (!sheet) return;
    const html = document.documentElement;
    html.classList.add('bmt-printing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      html.classList.remove('bmt-printing');
      setSheet(null);
    };
    // Unmount only once the dialog has closed: some browsers (Safari on a phone) return from print()
    // straight away and lay the page out afterwards. On screen the sheet is display:none, so leaving
    // it mounted until `afterprint` costs nothing.
    window.addEventListener('afterprint', finish);
    // Let the portal paint before the dialog opens.
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', finish);
      html.classList.remove('bmt-printing');
    };
  }, [sheet]);

  return (
    <>
      <button
        type="button"
        disabled={disabled || !entries}
        onClick={() => entries && setSheet(runSheet(entries, day, today, { showMoney }))}
        className={buttonClass('ghost', 'sm')}
      >
        <IconDocument width={14} height={14} aria-hidden="true" />
        {label}
      </button>
      {sheet && createPortal(<RunSheetDocument sheet={sheet} />, document.body)}
    </>
  );
}

/** The printed page. Plain markup; its look lives in the print rules in app/globals.css. */
export function RunSheetDocument({ sheet }: { sheet: RunSheet }) {
  return (
    <div className="bmt-print-sheet">
      <header className="rs-head">
        <h1>Run sheet · {sheet.title}</h1>
        <p>{sheet.totals}</p>
      </header>
      {sheet.blocks.length === 0 && <p className="rs-empty">Nothing booked on this day.</p>}
      {sheet.blocks.map((b) => (
        <section key={b.key} className="rs-block">
          <h2>
            <span className="rs-time">{b.time}</span>
            <span className="rs-title">
              {b.title}
              {b.subtitle ? ` — ${b.subtitle}` : ''}
            </span>
            {b.calledOff && <span className="rs-off">CALLED OFF</span>}
          </h2>
          <p className="rs-meta">
            {b.kind}
            {b.summary ? ` · ${b.summary}` : ''}
          </p>
          <table className="rs-parties">
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">Pick-up</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {b.parties.map((p) => (
                <tr key={p.key}>
                  <td>
                    <strong>{p.name}</strong>
                    <span className="rs-sub">{p.ref}</span>
                    {p.guests && <span className="rs-sub">{p.guests}</span>}
                    {p.unpaid && <span className="rs-flag">NOT PAID YET</span>}
                    {p.payment && (
                      <span className="rs-sub">
                        {p.payment.label}
                        {p.balanceDue ? ` · ${p.balanceDue}` : ''}
                      </span>
                    )}
                  </td>
                  <td>
                    {p.pickupPlace && (
                      <span className="rs-place">
                        <PickupText text={p.pickupPlace} />
                      </span>
                    )}
                    {p.pickupNote && <span className="rs-sub">{p.pickupNote}</span>}
                    {!p.pickupPlace && !p.pickupNote && '—'}
                  </td>
                  <td>
                    {p.facts.length === 0 ? (
                      '—'
                    ) : (
                      <dl className="rs-facts">
                        {p.facts.map((f) => (
                          <div key={f.k}>
                            <dt>{f.k}</dt>
                            <dd>{f.v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
