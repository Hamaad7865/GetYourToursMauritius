export interface PricedLine {
  quantity: number;
  unitAmountMinor: number;
}

/** Minor units only — never floats. A fractional quantity is a caller bug, not something to round. */
export function lineSubtotalMinor(line: PricedLine): number {
  if (!Number.isInteger(line.quantity)) {
    throw new Error(`Quote line quantity must be a whole number, got ${line.quantity}`);
  }
  if (!Number.isInteger(line.unitAmountMinor)) {
    throw new Error(`Quote line unit amount must be a whole number, got ${line.unitAmountMinor}`);
  }
  return line.quantity * line.unitAmountMinor;
}

export function quoteTotalMinor(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => sum + lineSubtotalMinor(line), 0);
}
