import { describe, expect, it } from 'vitest';
import { extractHeadings, stripHtml } from '@/lib/seed/parse';

describe('seed HTML parser', () => {
  it('strips tags and decodes common entities', () => {
    expect(stripHtml('<span>Sea&nbsp;Walking&#8211;Deluxe</span>')).toBe('Sea Walking–Deluxe');
    expect(stripHtml('Dolphins &amp; Whales')).toBe('Dolphins & Whales');
  });

  it('extracts deduplicated activity titles from h2/h3 headings', () => {
    const html = `
      <div class="elementor">
        <h1>Belle Mare Tours</h1>
        <h2 class="elementor-heading-title">Catamaran Cruise &#8211; Île Aux Cerfs</h2>
        <h3 class="card-title">Swim with Dolphins</h3>
        <h3 class="card-title">Swim with Dolphins</h3>
        <h2></h2>
        <p>Not a heading</p>
      </div>`;
    expect(extractHeadings(html)).toEqual([
      'Catamaran Cruise – Île Aux Cerfs',
      'Swim with Dolphins',
    ]);
  });
});
