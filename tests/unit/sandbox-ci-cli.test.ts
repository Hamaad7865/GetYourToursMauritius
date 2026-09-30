import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The workflow calls scripts/sandbox/ci.mjs as a command, so this runs the REAL entry point in a
 * throwaway directory: what it writes, what it refuses, and — for a refusal — that it stops before
 * touching the network. Every refusing case fails at the guard rails, before any request is made,
 * and the environment handed to the process is minimal so nothing from the developer's machine
 * can leak into a run.
 */
const SCRIPT = resolve('scripts/sandbox/ci.mjs');
const SANDBOX_REF = 'akhwocmxvpfqrkxywtcp';
const PROD_REF = 'dwjkfowhrrvdiqligxcj';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
const ANON = jwt({ ref: SANDBOX_REF, role: 'anon' });

function run(command: string, env: Record<string, string>, cwd: string) {
  const r = spawnSync(process.execPath, [SCRIPT, command], {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const workdir = () => mkdtempSync(join(tmpdir(), 'sandbox-ci-'));

describe('ci.mjs build-env', () => {
  it('writes the sandbox build env and prints only names', () => {
    const dir = workdir();
    const r = run(
      'build-env',
      {
        SANDBOX_SUPABASE_URL: `https://${SANDBOX_REF}.supabase.co`,
        SANDBOX_SUPABASE_ANON_KEY: ANON,
        SANDBOX_RESOLVED_SITE_URL: 'https://belle-mare-sandbox.pages.dev',
        PRODUCTION_SUPABASE_REF: PROD_REF,
      },
      dir,
    );
    expect(r.code).toBe(0);
    const file = readFileSync(join(dir, '.env.production.local'), 'utf8');
    expect(file).toContain('NEXT_PUBLIC_SITE_URL=https://belle-mare-sandbox.pages.dev');
    expect(file).toContain('NEXT_PUBLIC_SITE_NOINDEX=true');
    expect(file.split('\n')).toContain('NEXT_PUBLIC_GTM_ID=');
    expect(r.out).not.toContain(ANON);
  });

  it('refuses the production Supabase project and writes nothing', () => {
    const dir = workdir();
    const r = run(
      'build-env',
      {
        SANDBOX_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
        SANDBOX_SUPABASE_ANON_KEY: jwt({ ref: PROD_REF, role: 'anon' }),
        SANDBOX_RESOLVED_SITE_URL: 'https://belle-mare-sandbox.pages.dev',
      },
      dir,
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/PRODUCTION Supabase project/);
    expect(existsSync(join(dir, '.env.production.local'))).toBe(false);
  });
});

describe('ci.mjs pin-wrangler', () => {
  it('points the workspace wrangler.toml at the sandbox project', () => {
    const dir = workdir();
    copyFileSync('wrangler.toml', join(dir, 'wrangler.toml'));
    const r = run('pin-wrangler', { SANDBOX_RESOLVED_PROJECT: 'belle-mare-sandbox' }, dir);
    expect(r.code).toBe(0);
    const toml = readFileSync(join(dir, 'wrangler.toml'), 'utf8');
    expect(toml).toMatch(/^name = "belle-mare-sandbox"$/m);
    expect(toml).not.toMatch(/^name = "bellemaretours"$/m);
  });

  it('refuses the production project and leaves the file untouched', () => {
    const dir = workdir();
    copyFileSync('wrangler.toml', join(dir, 'wrangler.toml'));
    const before = readFileSync(join(dir, 'wrangler.toml'), 'utf8');
    const r = run('pin-wrangler', { SANDBOX_RESOLVED_PROJECT: 'bellemaretours' }, dir);
    expect(r.code).toBe(1);
    expect(readFileSync(join(dir, 'wrangler.toml'), 'utf8')).toBe(before);
  });

  it('refuses a name with no "sandbox" in it', () => {
    const dir = workdir();
    writeFileSync(join(dir, 'wrangler.toml'), 'name = "x"\n');
    expect(run('pin-wrangler', { SANDBOX_RESOLVED_PROJECT: 'some-other-site' }, dir).code).toBe(1);
  });
});

describe('ci.mjs resolve (guard rails run before anything touches Cloudflare)', () => {
  it('stops with a checklist when nothing is configured', () => {
    const r = run('resolve', {}, workdir());
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/npm run sandbox:secrets/);
    expect(r.out).toMatch(/nothing was built or deployed/i);
  });

  it('stops when the settings point at production, even with a valid-looking token', () => {
    const r = run(
      'resolve',
      {
        CLOUDFLARE_API_TOKEN: 'cf-token-abcdef123456',
        CLOUDFLARE_ACCOUNT_ID: 'acct1234567890',
        SANDBOX_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
        SANDBOX_SUPABASE_ANON_KEY: jwt({ ref: PROD_REF, role: 'anon' }),
        SANDBOX_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD_REF, role: 'service_role' }),
        SANDBOX_SUPABASE_JWT_SECRET: 'jwt-secret-value-0123456789',
        SANDBOX_INTERNAL_TASK_SECRET: 'internal-task-secret-0123',
        SANDBOX_DB_URL: `postgresql://postgres.${PROD_REF}:pw@h:5432/postgres`,
      },
      workdir(),
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/PRODUCTION Supabase project/);
    expect(r.out).not.toContain('cf-token-abcdef123456');
  });

  it('refuses when the sandbox project would be the production one', () => {
    const r = run(
      'resolve',
      {
        CLOUDFLARE_API_TOKEN: 'cf-token-abcdef123456',
        CLOUDFLARE_ACCOUNT_ID: 'acct1234567890',
        SANDBOX_PAGES_PROJECT: 'bellemaretours',
      },
      workdir(),
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/PRODUCTION Pages project/);
  });
});

describe('ci.mjs', () => {
  it('rejects an unknown command', () => {
    const r = run('deploy-everything', {}, workdir());
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/unknown command/);
  });
});
