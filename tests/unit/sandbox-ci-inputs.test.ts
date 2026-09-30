import { describe, expect, it } from 'vitest';
import { checkBuildInputs, checkProjectName } from '../../scripts/sandbox/ci.mjs';

/**
 * The two steps that get only a FEW values (the build, and the wrangler pin) check those values on
 * their own instead of trusting an earlier step — so these are the same guard rails, in miniature.
 */
const SANDBOX_REF = 'akhwocmxvpfqrkxywtcp';
const PROD_REF = 'dwjkfowhrrvdiqligxcj';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;

describe('checkProjectName', () => {
  it('accepts a sandbox name', () => {
    expect(checkProjectName('belle-mare-sandbox')).toEqual([]);
    expect(checkProjectName('belle-mare-sandbox-2')).toEqual([]);
  });

  it('refuses the production project, a name without "sandbox" and a malformed name', () => {
    expect(checkProjectName('bellemaretours').length).toBeGreaterThan(0);
    expect(checkProjectName('getyourtoursmauritius').length).toBeGreaterThan(0);
    expect(checkProjectName('my-live-site').join(' ')).toMatch(/sandbox/);
    expect(checkProjectName('Belle Mare Sandbox').length).toBeGreaterThan(0);
    expect(checkProjectName('').length).toBeGreaterThan(0);
  });

  it('refuses a production name handed in by the workflow, even one it does not know', () => {
    expect(checkProjectName('acme-sandbox', ['acme-sandbox']).join(' ')).toMatch(/PRODUCTION/);
  });
});

describe('checkBuildInputs', () => {
  it('passes a sandbox URL with a matching anon key', () => {
    const r = checkBuildInputs({
      supabaseUrl: `https://${SANDBOX_REF}.supabase.co`,
      anonKey: jwt({ ref: SANDBOX_REF, role: 'anon' }),
      productionRef: PROD_REF,
    });
    expect(r.errors).toEqual([]);
    expect(r.ref).toBe(SANDBOX_REF);
  });

  it('refuses the production project', () => {
    const r = checkBuildInputs({
      supabaseUrl: `https://${PROD_REF}.supabase.co`,
      anonKey: jwt({ ref: PROD_REF, role: 'anon' }),
    });
    expect(r.errors.join(' ')).toMatch(/PRODUCTION Supabase project/);
  });

  it('refuses a key from a different project than the URL', () => {
    const r = checkBuildInputs({
      supabaseUrl: `https://${SANDBOX_REF}.supabase.co`,
      anonKey: jwt({ ref: PROD_REF, role: 'anon' }),
    });
    expect(r.errors.join(' ')).toMatch(/belongs to Supabase project/);
  });

  it('refuses a missing key and a URL that is not a Supabase project', () => {
    const noKey = checkBuildInputs({
      supabaseUrl: `https://${SANDBOX_REF}.supabase.co`,
      anonKey: '',
    });
    expect(noKey.errors.join(' ')).toMatch(/missing/);
    const notSupabase = checkBuildInputs({ supabaseUrl: 'https://example.com', anonKey: 'x' });
    expect(notSupabase.errors).toHaveLength(1);
    expect(notSupabase.ref).toBeNull();
  });
});
