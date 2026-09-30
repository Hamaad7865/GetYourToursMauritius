import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildUploadPlan, parseEnvFile } from '../../scripts/sandbox/push-github-secrets.mjs';

/**
 * The owner-run uploader copies sandbox settings from .env.local to GitHub. What matters is what it
 * will NOT do: it reads only an allowlist of names, it refuses production and live-payment values
 * before anything leaves the machine, and it never uploads the local site URL.
 */
const REF = 'akhwocmxvpfqrkxywtcp';
const PROD_REF = 'dwjkfowhrrvdiqligxcj';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT_SECRET = 'jwt-secret-value-0123456789';
/** A real HS256 JWT signed with `secret` — the way Supabase signs its anon / service_role keys. */
const jwt = (claims: object, secret: string = JWT_SECRET) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
};

function localEnv(over: Record<string, string> = {}): Record<string, string> {
  return {
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: REF, role: 'anon' }),
    SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: 'service_role' }),
    SUPABASE_JWT_SECRET: JWT_SECRET,
    INTERNAL_TASK_SECRET: 'internal-task-secret-0123',
    SUPABASE_DB_URL: `postgresql://postgres.${REF}:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    PEACH_CLIENT_ID: 'cid',
    PEACH_CLIENT_SECRET: 'peach-client-secret-value',
    PEACH_MERCHANT_ID: 'mid',
    PEACH_ENTITY_ID: 'eid',
    PEACH_WEBHOOK_SECRET: 'peach-webhook-secret-value',
    PEACH_CHECKOUT_BASE_URL: 'https://testsecure.peachpayments.com',
    PEACH_AUTH_BASE_URL: 'https://sandbox-dashboard.peachpayments.com',
    PEACH_ENVIRONMENT: 'test',
    // Things that live in a real .env.local and must NEVER be picked up:
    RESEND_API_KEY: 're_live_secret',
    RESEND_FROM: 'Belle Mare Tours <bookings@bellemaretours.com>',
    GOOGLE_SERVICE_ACCOUNT_JSON: '{"private_key":"-----BEGIN"}',
    GSC_SERVICE_ACCOUNT_JSON: '{"private_key":"-----BEGIN"}',
    GOOGLE_GENERATIVE_AI_API_KEY: 'ai-key',
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'maps-key',
    VERCEL_OIDC_TOKEN: 'oidc-token',
    PEXELS_API_KEY: 'pexels',
    ...over,
  };
}

describe('parseEnvFile', () => {
  it('reads KEY=value lines, ignoring comments, blank lines and quotes', () => {
    const text = '# comment\n\nA=1\nB="two"\nexport C=\'three\'\nD = spaced \nE=a=b\n';
    expect(parseEnvFile(text)).toEqual({ A: '1', B: 'two', C: 'three', D: 'spaced', E: 'a=b' });
  });

  it('handles Windows line endings and lets a later duplicate win', () => {
    expect(parseEnvFile('A=1\r\nA=2\r\n')).toEqual({ A: '2' });
  });
});

describe('buildUploadPlan', () => {
  it('maps .env.local names to SANDBOX_* names and stores keys as secrets, URLs as variables', () => {
    const { plan, check } = buildUploadPlan(localEnv());
    expect(check.errors).toEqual([]);
    const byName = Object.fromEntries(plan.map((p) => [p.gh, p.kind]));
    expect(byName.SANDBOX_SUPABASE_URL).toBe('variable');
    expect(byName.SANDBOX_SUPABASE_SERVICE_ROLE_KEY).toBe('secret');
    expect(byName.SANDBOX_DB_URL).toBe('secret');
    expect(byName.SANDBOX_PEACH_CHECKOUT_BASE_URL).toBe('variable');
    expect(byName.SANDBOX_PEACH_CLIENT_SECRET).toBe('secret');
  });

  it('reads only the allowlist — email, Google, Maps, Vercel and other keys are never picked up', () => {
    const { plan, env, check } = buildUploadPlan(localEnv());
    const everything = JSON.stringify({ plan, env, values: check.config.values });
    for (const leaked of [
      're_live_secret',
      'bookings@bellemaretours.com',
      'BEGIN',
      'ai-key',
      'maps-key',
      'oidc-token',
      'pexels',
    ]) {
      expect(everything).not.toContain(leaked);
    }
    expect(plan.map((p) => p.gh).some((n) => /RESEND|GOOGLE|MAPS|VERCEL|PEXELS/.test(n))).toBe(
      false,
    );
  });

  it('never uploads the local site URL or the Peach environment flag (both are derived by the workflow)', () => {
    const { plan } = buildUploadPlan(localEnv());
    const names = plan.map((p) => p.gh);
    expect(names).not.toContain('SANDBOX_SITE_URL');
    expect(names).not.toContain('SANDBOX_PEACH_ENVIRONMENT');
    expect(names.some((n) => /SITE_URL|ENVIRONMENT/.test(n))).toBe(false);
  });

  it('refuses a .env.local that points at PRODUCTION', () => {
    const { check } = buildUploadPlan(
      localEnv({
        NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: PROD_REF, role: 'anon' }),
        SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD_REF, role: 'service_role' }),
        SUPABASE_DB_URL: `postgresql://postgres.${PROD_REF}:pw@h:5432/postgres`,
      }),
    );
    expect(check.ok).toBe(false);
    expect(check.errors.join('\n')).toMatch(/PRODUCTION/);
  });

  it('withholds a JWT secret that is not this project’s (e.g. production’s) — and still uploads the rest', () => {
    // A .env.local copied from the production one carries production's signing secret. It must not
    // reach GitHub or a public host; the sandbox does not need it (it verifies tokens by public key).
    const wrong = 'production-legacy-jwt-secret-000';
    const { check, plan, skipped, env } = buildUploadPlan(localEnv({ SUPABASE_JWT_SECRET: wrong }));
    expect(skipped).toEqual([
      {
        gh: 'SANDBOX_SUPABASE_JWT_SECRET',
        local: 'SUPABASE_JWT_SECRET',
        reason: 'not-this-projects-secret',
      },
    ]);
    expect(plan.map((p) => p.gh)).not.toContain('SANDBOX_SUPABASE_JWT_SECRET');
    expect(plan.length).toBeGreaterThan(8); // everything else still goes
    expect(check.ok).toBe(true);
    // The value is dropped entirely — it is in neither the plan, the environment nor the checked values.
    expect(JSON.stringify({ plan, env, values: check.config.values })).not.toContain(wrong);
  });

  it('keeps a JWT secret that does sign the project’s own keys', () => {
    const { plan, skipped, check } = buildUploadPlan(localEnv());
    expect(skipped).toEqual([]);
    expect(plan.map((p) => p.gh)).toContain('SANDBOX_SUPABASE_JWT_SECRET');
    expect(check.ok).toBe(true);
  });

  it('does not need a JWT secret at all (a project on asymmetric signing keys never reads one)', () => {
    const local = localEnv();
    delete (local as Record<string, string | undefined>).SUPABASE_JWT_SECRET;
    const { plan, notInLocal, check } = buildUploadPlan(local);
    expect(check.ok).toBe(true);
    expect(notInLocal).not.toContain('SUPABASE_JWT_SECRET');
    expect(plan.map((p) => p.gh)).not.toContain('SANDBOX_SUPABASE_JWT_SECRET');
  });

  it('refuses live Peach settings before they leave the machine', () => {
    expect(buildUploadPlan(localEnv({ PEACH_ENVIRONMENT: 'live' })).check.ok).toBe(false);
    expect(
      buildUploadPlan(localEnv({ PEACH_CHECKOUT_BASE_URL: 'https://secure.peachpayments.com' }))
        .check.ok,
    ).toBe(false);
  });

  it('--no-peach leaves the whole Peach group out, even a half-configured one', () => {
    const local = localEnv();
    delete (local as Record<string, string | undefined>).PEACH_CLIENT_SECRET;
    expect(buildUploadPlan(local).check.ok).toBe(false); // partly configured
    const skipped = buildUploadPlan(local, { noPeach: true });
    expect(skipped.check.ok).toBe(true);
    expect(skipped.plan.some((p) => p.gh.includes('PEACH'))).toBe(false);
  });

  it('reports required settings that are missing from .env.local', () => {
    const local = localEnv();
    delete (local as Record<string, string | undefined>).SUPABASE_DB_URL;
    const { notInLocal, check } = buildUploadPlan(local);
    expect(notInLocal).toContain('SUPABASE_DB_URL');
    expect(check.ok).toBe(false);
  });
});
