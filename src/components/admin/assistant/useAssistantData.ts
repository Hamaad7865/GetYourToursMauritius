'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
import { loadBookings, type BookingRow } from '@/lib/admin/bookings';
import { loadQuotes, type QuoteRow } from '@/lib/admin/quotes';
import { loadCalendarRange } from '@/lib/admin/calendar';
import { toCalLines } from '@/lib/admin/calendar-view';
import { mauDay } from '@/lib/admin/format';
import { runSheetRows, type RunRow } from '@/components/admin/today/rules';
import {
  balanceRows,
  type AssistantViewer,
  type BalanceRow,
} from '@/components/admin/assistant/rules';

/**
 * What the side chat knows without asking the model: the same three reads Today makes (bookings,
 * quotes, today's calendar), each made only when the person's role may see it, and only once the
 * panel is opened, so a closed panel costs nothing. A read that fails leaves its part empty and is
 * named in `failed`; the others still work.
 */

export interface AssistantData {
  /** null while loading, or when the role may not read them. */
  bookings: BookingRow[] | null;
  quotes: QuoteRow[] | null;
  balances: BalanceRow[] | null;
  departures: RunRow[] | null;
  /** Today in Mauritius, at the time of the last load. */
  today: string;
  /** Which reads failed ("bookings", "quotes", "calendar"). */
  failed: string[];
}

/** Reopening the panel after this long reads again, so the cards are not stale. */
const STALE_MS = 2 * 60 * 1000;

const EMPTY = (today: string): AssistantData => ({
  bookings: null,
  quotes: null,
  balances: null,
  departures: null,
  today,
  failed: [],
});

export function useAssistantViewer(): AssistantViewer {
  const access = useAdminAccess();
  const showMoney = can(access, 'money.revenue');
  const showBookings = can(access, 'section.bookings');
  const showQuotes = can(access, 'section.quotes');
  const showDepartures = can(access, ['section.bookings', 'section.calendar']);
  return useMemo(
    () => ({ showMoney, showBookings, showQuotes, showDepartures }),
    [showMoney, showBookings, showQuotes, showDepartures],
  );
}

export function useAssistantData(
  open: boolean,
  viewer: AssistantViewer,
): { data: AssistantData; loading: boolean; ensure: () => Promise<AssistantData> } {
  const [data, setData] = useState<AssistantData>(() => EMPTY(mauDay(new Date())));
  const [loading, setLoading] = useState(false);
  const latest = useRef(data);
  latest.current = data;
  const inFlight = useRef<Promise<AssistantData> | null>(null);
  const loadedAt = useRef(0);

  const load = useCallback((): Promise<AssistantData> => {
    if (inFlight.current) return inFlight.current;
    const today = mauDay(new Date());
    setLoading(true);
    const failed: string[] = [];
    const read = <T>(enabled: boolean, name: string, fn: () => Promise<T>): Promise<T | null> =>
      enabled
        ? fn().catch((err: unknown) => {
            console.error(`[assistant] ${name} could not be loaded`, err);
            failed.push(name);
            return null;
          })
        : Promise.resolve(null);

    const run = Promise.all([
      read(viewer.showBookings, 'bookings', loadBookings),
      read(viewer.showQuotes, 'quotes', loadQuotes),
      read(viewer.showDepartures, 'calendar', () => loadCalendarRange(today, today)),
    ]).then(([bookings, quotes, entries]) => {
      const next: AssistantData = {
        bookings,
        quotes,
        balances: bookings ? balanceRows(bookings, quotes) : null,
        departures: entries
          ? runSheetRows(toCalLines(entries, today), today, viewer.showMoney)
          : null,
        today,
        failed,
      };
      latest.current = next;
      setData(next);
      setLoading(false);
      loadedAt.current = Date.now();
      inFlight.current = null;
      return next;
    });
    inFlight.current = run;
    return run;
  }, [viewer]);

  useEffect(() => {
    if (!open) return;
    if (Date.now() - loadedAt.current < STALE_MS) return;
    void load();
  }, [open, load]);

  /** The data, waiting for the load in progress (or starting one) if there is none yet. */
  const ensure = useCallback(async (): Promise<AssistantData> => {
    if (inFlight.current) return inFlight.current;
    if (loadedAt.current === 0) return load();
    return latest.current;
  }, [load]);

  return { data, loading, ensure };
}
