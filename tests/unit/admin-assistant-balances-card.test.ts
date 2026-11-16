import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BalancesCard, DeparturesCard } from '@/components/admin/assistant/BalancesCard';
import type { BalanceRow } from '@/components/admin/assistant/rules';
import type { RunRow } from '@/components/admin/today/rules';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ push: () => {} }),
}));

/* The side chat's balances card, as first drawn: what is ticked, what the button will do, and what
 * a role without money sees. Sending is guarded in assistant-shell-wiring (one confirmation, the two
 * existing senders) and the question it asks in admin-assistant-panel-rules. */

const reminder = (id: string, owed: number, over: Partial<BalanceRow> = {}): BalanceRow => ({
  id,
  ref: `BMT-${id}`,
  name: `Guest ${id}`,
  email: `${id}@example.com`,
  phone: null,
  tripDay: '2026-10-19',
  owedEur: owed,
  totalEur: owed + 20,
  action: { kind: 'reminder', ref: `BMT-${id}`, seq: 1, label: '19 Oct tour' },
  sendable: true,
  ...over,
});

const openOnly = (id: string): BalanceRow =>
  reminder(id, 40, {
    action: { kind: 'link', href: `/admin/bookings?open=${id}`, label: 'Open' },
    sendable: false,
  });

const render = (rows: BalanceRow[], showMoney = true) =>
  renderToStaticMarkup(createElement(BalancesCard, { rows, showMoney }));

describe('the balances card', () => {
  it('ticks every row it can send and says what pressing the button will do', () => {
    const html = render([reminder('a', 1400), reminder('b', 60)]);
    expect(html.match(/type="checkbox"[^>]*checked/g)).toHaveLength(2);
    expect(html).toContain('Send 2 reminders');
    expect(html).toContain('Nothing is sent until you confirm.');
    expect(html).toContain('€1,400');
    expect(html).toContain('Trip 19 Oct');
  });

  it('a row with no sender has no checkbox, only a way to open its booking', () => {
    const html = render([reminder('a', 100), openOnly('c')]);
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).toContain('href="/admin/bookings?open=c"');
    expect(html).toContain('Send 1 reminder');
  });

  it('with nothing sendable there is no send button and no promise about confirming', () => {
    const html = render([openOnly('c')]);
    expect(html).not.toContain('Send ');
    expect(html).not.toContain('Nothing is sent');
  });

  it('a role without money sees who, never how much, and no amount filter', () => {
    const html = render([reminder('a', 1400), reminder('b', 60)], false);
    expect(html).not.toContain('€');
    expect(html).not.toContain('Only over');
  });

  it('offers the amount filter only when it would narrow the list', () => {
    expect(render([reminder('a', 1400), reminder('b', 60)])).toContain('Only over €100');
    expect(render([reminder('a', 1400), reminder('b', 600)])).not.toContain('Only over');
  });

  it('a card brought back from History shows who was emailed and never offers them again', () => {
    const html = renderToStaticMarkup(
      createElement(BalancesCard, {
        rows: [reminder('a', 1400), reminder('b', 60)],
        showMoney: true,
        sent: { a: { status: 'done', text: 'Reminder sent to a@example.com.' } },
      }),
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).toContain('Reminder sent to a@example.com.');
    expect(html).toContain('Send 1 reminder');
  });

  it('folds a long list, and the button counts only the rows on screen', () => {
    const rows = Array.from({ length: 11 }, (_, i) => reminder(`r${i}`, 200 + i));
    const html = render(rows);
    expect(html).toContain('Show all 11');
    expect(html).toContain('Send 8 reminders');
  });
});

describe('the departures card', () => {
  const row: RunRow = {
    key: 'line 1',
    day: '2026-11-16',
    time: '08:45',
    allDay: false,
    title: 'Catamaran Cruise',
    subtitle: null,
    guests: 4,
    pendingGuests: 2,
    capacity: null,
    pickups: 3,
    cancelled: false,
    chip: { label: 'All paid', tone: 'ok' },
  };

  it('opens each departure on the calendar', () => {
    const html = renderToStaticMarkup(createElement(DeparturesCard, { rows: [row] }));
    expect(html).toContain('href="/admin/calendar?day=2026-11-16&amp;line=line%201"');
    expect(html).toContain('4 guests · 3 pickups · +2 unpaid');
  });
});
