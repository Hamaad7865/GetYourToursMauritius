import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MANAGED_RUNTIME_NAMES,
  SANDBOX_SETTINGS,
  buildPagesConfigPatch,
  checkSandboxConfig,
  evaluateHealth,
} from '../../scripts/sandbox/ci.mjs';
import { buildUploadPlan } from '../../scripts/sandbox/push-github-secrets.mjs';

/**
 * Mail on the hosted sandbox. Its database is full of fake customers (and the owner's own test
 * addresses) and its cron drains the outbox every two minutes, so a real mail key must never be able to
 * reach any of them. The app enforces that with EMAIL_REDIRECT_TO (every email to ONE inbox); the deploy
 * tooling enforces that a key never travels without it.
 */
const REF = 'akhwocmxvpfqrkxywtcp';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SECRET = 'jwt-secret-value-0123456789';
const jwt = (claims: object) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
};

const MAIL = {
  SANDBOX_RESEND_API_KEY: 're_sandbox_key_0123456789',
  SANDBOX_RESEND_FROM: 'Belle Mare Tours <bookings@example-sender.org>',
  SANDBOX_EMAIL_REDIRECT_TO: 'tester@gmail.com',
};

function env(over: Record<string, string> = {}): Record<string, string> {
  return {
    CLOUDFLARE_API_TOKEN: 'cf-token-abcdef123456',
    CLOUDFLARE_ACCOUNT_ID: 'acct1234567890',
    PRODUCTION_SUPABASE_REF: 'dwjkfowhrrvdiqligxcj',
    PRODUCTION_PAGES_PROJECT: 'bellemaretours',
    PRODUCTION_URL: 'https://bellemaretours.com',
    CANONICAL_HOST: 'bellemaretours.com',
    SANDBOX_SUPABASE_URL: `https://${REF}.supabase.co`,
    SANDBOX_SUPABASE_ANON_KEY: jwt({ ref: REF, role: 'anon' }),
    SANDBOX_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: 'service_role' }),
    SANDBOX_INTERNAL_TASK_SECRET: 'internal-task-secret-0123',
    SANDBOX_DB_URL: `postgresql://postgres.${REF}:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    ...over,
  };
}
const without = (e: Record<string, string>, ...names: string[]) => {
  const copy = { ...e };
  for (const n of names) delete copy[n];
  return copy;
};

describe('checkSandboxConfig — mail', () => {
  it('needs no mail at all: the sandbox then simply sends nothing', () => {
    const r = checkSandboxConfig(env());
    expect(r.ok).toBe(true);
    expect(r.config.emailConfigured).toBe(false);
  });

  it('accepts a key, a sender and the redirect inbox together', () => {
    const r = checkSandboxConfig(env(MAIL));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.config.emailConfigured).toBe(true);
  });

  it('REFUSES a mail key without the redirect inbox — that is the fake-customer / real-domain hazard', () => {
    const r = checkSandboxConfig(env(without(MAIL, 'SANDBOX_EMAIL_REDIRECT_TO')));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/SANDBOX_EMAIL_REDIRECT_TO/);
    expect(r.config.emailConfigured).toBe(false);
  });

  it('refuses any partial mail configuration, naming what is missing', () => {
    for (const missing of ['SANDBOX_RESEND_API_KEY', 'SANDBOX_RESEND_FROM']) {
      const r = checkSandboxConfig(env(without(MAIL, missing)));
      expect(r.ok, missing).toBe(false);
      expect(r.errors.join(' '), missing).toContain(missing);
    }
    // A redirect inbox on its own is also half a configuration.
    const alone = checkSandboxConfig(env({ SANDBOX_EMAIL_REDIRECT_TO: 'tester@gmail.com' }));
    expect(alone.ok).toBe(false);
  });

  it('refuses a redirect that is not an address, or that can never receive mail', () => {
    for (const bad of [
      'not-an-email',
      'two words@gmail.com',
      'customer@sandbox.test',
      'anyone@example.com',
      'someone@localhost',
      'x@host.invalid',
    ]) {
      const r = checkSandboxConfig(env({ ...MAIL, SANDBOX_EMAIL_REDIRECT_TO: bad }));
      expect(r.ok, bad).toBe(false);
      expect(r.errors.join(' '), bad).toMatch(/SANDBOX_EMAIL_REDIRECT_TO/);
      // The address is a secret: it must never be echoed into an error line (workflow logs are visible).
      expect(r.errors.join(' '), bad).not.toContain(bad);
    }
  });

  it('warns — does not refuse — when the redirect inbox is at the LIVE domain', () => {
    const r = checkSandboxConfig(
      env({ ...MAIL, SANDBOX_EMAIL_REDIRECT_TO: 'info@bellemaretours.com' }),
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/live domain/i);
  });

  it('requires the sender to be an address', () => {
    const r = checkSandboxConfig(env({ ...MAIL, SANDBOX_RESEND_FROM: 'Belle Mare Tours' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/SANDBOX_RESEND_FROM/);
  });
});

describe('the settings table — mail', () => {
  const mail = SANDBOX_SETTINGS.filter((s) => s.group === 'email');

  it('has exactly the three mail settings, every one SANDBOX_-named', () => {
    expect(mail.map((s) => s.gh).sort()).toEqual(Object.keys(MAIL).sort());
    for (const s of mail) expect(s.gh.startsWith('SANDBOX_')).toBe(true);
  });

  it('reads them from SANDBOX_-named local variables, so a production RESEND_API_KEY in .env.local can never be picked up', () => {
    for (const s of mail) expect(s.local.startsWith('SANDBOX_'), s.gh).toBe(true);
    const local = {
      RESEND_API_KEY: 're_PRODUCTION_key_must_not_travel',
      RESEND_FROM: 'Belle Mare Tours <bookings@bellemaretours.com>',
      ...MAIL,
    };
    const { plan, env: e } = buildUploadPlan(local);
    const uploaded = plan.map((p: { gh: string }) => p.gh);
    for (const n of Object.keys(MAIL)) expect(uploaded).toContain(n);
    const everything = JSON.stringify(e);
    expect(everything).not.toContain('re_PRODUCTION_key_must_not_travel');
    expect(everything).not.toContain('bookings@bellemaretours.com');
  });

  it('stores the key and the redirect inbox as secrets, the sender as a variable', () => {
    const kind = Object.fromEntries(mail.map((s) => [s.gh, s.kind]));
    expect(kind.SANDBOX_RESEND_API_KEY).toBe('secret');
    expect(kind.SANDBOX_EMAIL_REDIRECT_TO).toBe('secret');
    expect(kind.SANDBOX_RESEND_FROM).toBe('variable');
  });

  it('maps them onto the runtime names the app reads', () => {
    const runtime = Object.fromEntries(mail.map((s) => [s.gh, s.runtime]));
    expect(runtime).toEqual({
      SANDBOX_RESEND_API_KEY: 'RESEND_API_KEY',
      SANDBOX_RESEND_FROM: 'RESEND_FROM',
      SANDBOX_EMAIL_REDIRECT_TO: 'EMAIL_REDIRECT_TO',
    });
    for (const n of ['RESEND_API_KEY', 'RESEND_FROM', 'EMAIL_REDIRECT_TO']) {
      expect(MANAGED_RUNTIME_NAMES).toContain(n);
    }
  });
});

describe('buildPagesConfigPatch — mail', () => {
  const values = {
    SANDBOX_SUPABASE_URL: `https://${REF}.supabase.co`,
    ...MAIL,
  };

  it('sends the three settings to the Pages project as secrets', () => {
    const patch = buildPagesConfigPatch({
      values,
      siteUrl: 'https://belle-mare-sandbox.pages.dev',
      peachConfigured: false,
    });
    const vars = patch.deployment_configs.production.env_vars as Record<string, unknown>;
    expect(vars.RESEND_API_KEY).toEqual({
      type: 'secret_text',
      value: MAIL.SANDBOX_RESEND_API_KEY,
    });
    expect(vars.RESEND_FROM).toEqual({ type: 'secret_text', value: MAIL.SANDBOX_RESEND_FROM });
    expect(vars.EMAIL_REDIRECT_TO).toEqual({
      type: 'secret_text',
      value: MAIL.SANDBOX_EMAIL_REDIRECT_TO,
    });
  });

  it('TURNS MAIL OFF when the settings are removed from GitHub (they are cleared from the project)', () => {
    const patch = buildPagesConfigPatch({
      values: { SANDBOX_SUPABASE_URL: values.SANDBOX_SUPABASE_URL },
      siteUrl: 'https://belle-mare-sandbox.pages.dev',
      peachConfigured: false,
      existingNames: ['RESEND_API_KEY', 'RESEND_FROM', 'EMAIL_REDIRECT_TO'],
    });
    const vars = patch.deployment_configs.production.env_vars as Record<string, unknown>;
    expect(vars.RESEND_API_KEY).toBeNull();
    expect(vars.RESEND_FROM).toBeNull();
    expect(vars.EMAIL_REDIRECT_TO).toBeNull();
  });
});

describe('evaluateHealth — mail', () => {
  const report = (emailConfigured: boolean) => ({
    data: {
      status: 'ok',
      live: false,
      releaseSha: 'abc',
      checks: {
        supabaseConfigured: true,
        serviceRoleConfigured: true,
        siteUrlConfigured: true,
        internalTasksConfigured: true,
        paymentsSafe: true,
        emailConfigured,
      },
    },
  });

  it('FAILS the run when mail was configured but the deployed site cannot send', () => {
    const { fatal } = evaluateHealth(report(false), 'abc', { emailConfigured: true });
    expect(fatal.join(' ')).toMatch(/mail is unavailable/);
  });

  it('is content when mail was configured and the site reports it', () => {
    expect(evaluateHealth(report(true), 'abc', { emailConfigured: true }).fatal).toEqual([]);
  });

  it('does not mind a site without mail when none was configured', () => {
    const r = evaluateHealth(report(false), 'abc', { emailConfigured: false });
    expect(r.fatal).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
