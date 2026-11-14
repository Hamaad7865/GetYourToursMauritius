import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AdminError,
  BTN_GHOST,
  BTN_PRIMARY,
  Checklist,
  DataTable,
  INPUT_CLS,
  Kpi,
  ListRow,
  Panel,
  ProgressBar,
  SectionRail,
  Segmented,
  SplitView,
  StatusChip,
  Switch,
  Tabs,
  Td,
  Th,
  Tr,
  buttonClass,
} from '@/components/admin/ui';
import { inputClass } from '@/components/admin/fields';

/**
 * The back office's shared pieces (src/components/admin/ui.tsx). What is pinned is what a screen
 * reader and a keyboard get — the state each control announces and the element it is — plus the two
 * contrast rules the redesign rests on. Pixels are not asserted; a source scan cannot see a cascade.
 */

const html = (el: ReturnType<typeof h>) => renderToStaticMarkup(el);
const noop = () => {};

describe('the shared controls keep AA contrast', () => {
  it('fills primary buttons with teal-dark, never the brand teal', () => {
    expect(BTN_PRIMARY).toContain('bg-teal-dark');
    expect(BTN_PRIMARY).not.toMatch(/(^|\s)bg-teal(\s|$)/);
    expect(BTN_PRIMARY).toContain('text-white');
  });

  it('sizes controls with padding and min-height, so an appended class or a textarea still fits', () => {
    for (const cls of [INPUT_CLS, BTN_PRIMARY, BTN_GHOST, buttonClass('quiet', 'sm')]) {
      expect(cls).not.toMatch(/(^|\s)h-\d/);
    }
    // The tour editor's panes put inputClass on textareas and selects: it must be the same control.
    expect(inputClass).toBe(INPUT_CLS);
  });

  it('writes problems in coral-dark and announces them', () => {
    const out = html(h(AdminError, null, 'Could not save'));
    expect(out).toContain('role="alert"');
    expect(out).toContain('text-coral-dark');
  });
});

describe('StatusChip', () => {
  it('carries the words, with a decorative dot and the tone as colour', () => {
    const out = html(h(StatusChip, { tone: 'warn', children: 'Part paid' }));
    expect(out).toContain('Part paid');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('text-gold-dark');
  });

  it('defaults to neutral', () => {
    expect(html(h(StatusChip, null, 'Pending'))).toContain('text-ink-muted');
  });
});

describe('Switch', () => {
  it('is a real button whose state is aria-pressed', () => {
    const on = html(h(Switch, { checked: true, onChange: noop, label: 'Shown on the site' }));
    expect(on).toMatch(/^<button type="button" aria-pressed="true" aria-label="Shown on the site"/);
    const off = html(h(Switch, { checked: false, onChange: noop, label: 'Shown on the site' }));
    expect(off).toContain('aria-pressed="false"');
  });
});

describe('Tabs', () => {
  it('draws route tabs as links in a nav, the current one aria-current', () => {
    const out = html(
      h(Tabs, {
        label: 'Catalogue setup',
        active: 'categories',
        items: [
          { id: 'categories', label: 'Categories', href: '/admin/categories' },
          { id: 'content', label: 'Standard content', href: '/admin/content', count: 5 },
        ],
      }),
    );
    expect(out).toMatch(/^<nav aria-label="Catalogue setup"/);
    expect(out).toMatch(/<a aria-current="page"[^>]*href="\/admin\/categories"/);
    expect(out.match(/aria-current=/g)).toHaveLength(1);
    expect(out).toContain('>5</span>');
  });

  it('draws filter tabs as pressed buttons', () => {
    const out = html(
      h(Tabs, {
        label: 'Saved views',
        active: 'all',
        onSelect: noop,
        items: [
          { id: 'all', label: 'All' },
          { id: 'awaiting', label: 'Awaiting payment' },
        ],
      }),
    );
    expect(out).toContain('role="group"');
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out).not.toContain('role="tab"');
  });
});

describe('Segmented', () => {
  it('marks exactly the chosen option', () => {
    const out = html(
      h(Segmented, {
        label: 'Period',
        value: '4w',
        onChange: noop,
        options: [
          { value: '7d', label: '7 days' },
          { value: '4w', label: '4 weeks' },
        ],
      }),
    );
    expect(out).toContain('aria-label="Period"');
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-pressed="true"[^>]*>4 weeks</);
  });
});

describe('ProgressBar', () => {
  it('is a readable progressbar when labelled, clamped to its track', () => {
    const out = html(h(ProgressBar, { value: 14, max: 12, label: 'Seats taken' }));
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="14"');
    expect(out).toContain('width:100%');
  });

  it('is decoration when the figure is printed beside it', () => {
    const out = html(h(ProgressBar, { value: 3, max: 12 }));
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain('role=');
    expect(out).toContain('width:25%');
  });

  it('never divides by zero', () => {
    expect(html(h(ProgressBar, { value: 2, max: 0 }))).toContain('width:0%');
  });
});

describe('DataTable', () => {
  it('scrolls in its own box, with column headers scoped and figures right-aligned', () => {
    const out = html(
      h(DataTable, {
        label: 'Bookings',
        dense: true,
        children: [
          h(
            'thead',
            { key: 'h' },
            h('tr', null, h(Th, null, 'Guest'), h(Th, { num: true }, 'Total')),
          ),
          h(
            'tbody',
            { key: 'b' },
            h(Tr, { selected: true }, h(Td, null, 'Marie'), h(Td, { num: true }, '€372.00')),
            h(Tr, { total: true }, h(Td, null, 'Total'), h(Td, { num: true }, '€372.00')),
          ),
        ],
      }),
    );
    expect(out).toMatch(/^<div class="overflow-x-auto"><table aria-label="Bookings"/);
    expect(out.match(/scope="col"/g)).toHaveLength(2);
    expect(out).toContain('[&amp;_td]:py-[7px]');
    expect(out).toMatch(/<th scope="col" class="text-right/);
    expect(out).toContain('aria-current="true"');
  });
});

describe('ListRow, Kpi and SplitView', () => {
  it('makes a row a link, a button, or neither', () => {
    expect(html(h(ListRow, { title: 'New enquiry', href: '/admin/leads' }))).toMatch(/^<a /);
    expect(html(h(ListRow, { title: 'New enquiry', onClick: noop }))).toMatch(
      /^<button type="button"/,
    );
    expect(html(h(ListRow, { title: 'New enquiry', selected: true }))).toMatch(/^<div /);
  });

  it('links a KPI card only when given somewhere to go', () => {
    expect(html(h(Kpi, { label: 'Departures today', value: 4, href: '/admin/calendar' }))).toMatch(
      /^<a /,
    );
    expect(html(h(Kpi, { label: 'Departures today', value: 4 }))).toMatch(/^<div /);
  });

  it('only splits when there is a detail to show', () => {
    const both = html(h(SplitView, { list: 'L', detail: 'D', detailLabel: 'Booking details' }));
    expect(both).toContain('<aside aria-label="Booking details"');
    expect(both).toContain('xl:grid-cols-[minmax(0,1fr)_400px]');
    const listOnly = html(h(SplitView, { list: 'L', detailLabel: 'Booking details' }));
    expect(listOnly).not.toContain('<aside');
    expect(listOnly).not.toContain('grid-cols');
  });

  it('names a headerless panel', () => {
    expect(html(h(Panel, { label: 'Latest bookings', children: 'x' }))).toContain(
      'aria-label="Latest bookings"',
    );
    expect(html(h(Panel, { title: 'Latest bookings', children: 'x' }))).toContain('<h2');
  });
});

describe('Checklist and SectionRail', () => {
  it('reads each checklist state out, not just the tick', () => {
    const out = html(
      h(Checklist, {
        label: 'Before it goes live',
        items: [
          { label: 'Has a photo', done: true },
          { label: 'Has a price', done: false },
        ],
      }),
    );
    expect(out).toContain('Done: ');
    expect(out).toContain('To do: ');
  });

  it('marks the current section and reads its status', () => {
    const out = html(
      h(SectionRail, {
        label: 'Tour sections',
        active: 'pricing',
        onSelect: noop,
        items: [
          { id: 'basics', label: 'Basics', status: 'ok' },
          { id: 'pricing', label: 'Pricing', status: 'bad' },
        ],
      }),
    );
    expect(out).toContain('aria-label="Tour sections"');
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
    expect(out).toContain('complete');
    expect(out).toContain('has a problem');
  });
});
