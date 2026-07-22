import { describe, expect, it } from 'vitest';
import {
  computeLedgerParity,
  assertNoPendingMigrations,
} from '../../scripts/release/supabase-ledger.mjs';

const FIRST = { version: '20260615120000', name: 'enums', file: '20260615120000_enums.sql' };
const SECOND = {
  version: '20260615120100',
  name: 'catalogue',
  file: '20260615120100_catalogue.sql',
};
const THIRD = {
  version: '20260615120200',
  name: 'inventory',
  file: '20260615120200_inventory.sql',
};
const LOCAL = [FIRST, SECOND, THIRD];

describe('release/supabase-ledger computeLedgerParity', () => {
  it('is in sync when remote versions exactly match local', () => {
    const remote = LOCAL.map((m) => m.version);
    const result = computeLedgerParity(LOCAL, remote);
    expect(result.inSync).toBe(true);
    expect(result.missingFromRemote).toEqual([]);
    expect(result.remoteOnly).toEqual([]);
  });

  it('flags a history gap — a local migration missing from remote', () => {
    const remote = [FIRST.version, THIRD.version];
    const result = computeLedgerParity(LOCAL, remote);
    expect(result.inSync).toBe(false);
    expect(result.missingFromRemote).toEqual([SECOND.version]);
  });

  it('flags an unexpected remote-only version', () => {
    const remote = [...LOCAL.map((m) => m.version), '20990101000000'];
    const result = computeLedgerParity(LOCAL, remote);
    expect(result.inSync).toBe(false);
    expect(result.remoteOnly).toEqual(['20990101000000']);
  });

  it('is in sync regardless of remote row order (order is not identity)', () => {
    const remote = [THIRD.version, FIRST.version, SECOND.version];
    expect(computeLedgerParity(LOCAL, remote).inSync).toBe(true);
  });

  it('treats an empty remote ledger as fully out of sync', () => {
    const result = computeLedgerParity(LOCAL, []);
    expect(result.inSync).toBe(false);
    expect(result.missingFromRemote).toEqual(LOCAL.map((m) => m.version));
  });
});

describe('release/supabase-ledger assertNoPendingMigrations', () => {
  it('is clean when the dry-run output mentions none of the local migration files', () => {
    const output = 'Remote database is up to date.';
    expect(assertNoPendingMigrations(output, LOCAL).clean).toBe(true);
  });

  it('flags a pending migration named in the dry-run output', () => {
    const output = `Would push the following migration:\n  ${THIRD.file}\n`;
    const result = assertNoPendingMigrations(output, LOCAL);
    expect(result.clean).toBe(false);
    expect(result.pending.map((m: { file: string }) => m.file)).toEqual([THIRD.file]);
  });
});
