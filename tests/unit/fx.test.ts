import { describe, expect, it } from 'vitest';
import { formatMur } from '@/lib/money/fx';

describe('formatMur', () => {
  /** Intl group separators vary (NBSP/narrow-NBSP in fr) — normalise to plain spaces for matching. */
  const norm = (s: string): string => s.replace(/[\s  ]/g, ' ');

  it('renders minor units with the ISO code, never ₨ (WinAnsi strips U+20A8 in the PDFs)', () => {
    expect(norm(formatMur(593800))).toBe('MUR 5,938.00');
    expect(formatMur(593800)).not.toContain('₨');
  });

  it('always shows two decimals so the figure matches what Peach displays', () => {
    expect(norm(formatMur(530000))).toBe('MUR 5,300.00');
    expect(norm(formatMur(0))).toBe('MUR 0.00');
  });

  it('localises digit grouping for fr', () => {
    expect(norm(formatMur(593800, 'fr'))).toBe('MUR 5 938,00');
  });
});
