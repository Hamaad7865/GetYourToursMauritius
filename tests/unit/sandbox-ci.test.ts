import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPATIBILITY_DATE,
  COMPATIBILITY_FLAGS,
  MANAGED_RUNTIME_NAMES,
  SANDBOX_SETTINGS,
  buildPagesConfigPatch,
  checkSandboxConfig,
  decodeJwtClaims,
  ensureProject,
  evaluateHealth,
  jwtSecretMatchesToken,
  pinWranglerProjectName,
  renderBuildEnv,
  supabaseRefFromUrl,
  syncProjectConfig,
} from '../../scripts/sandbox/ci.mjs';

/**
 * The sandbox deploy's guard rails. Nearly every default in this repo points at PRODUCTION, so each
 * case here is a specific way the sandbox could be wired to it — or to real money, or to the live
 * analytics — and the assertion is that it is REFUSED before anything is built or deployed.
 */
const SANDBOX_REF = 'akhwocmxvpfqrkxywtcp';
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

function validEnv(over: Record<string, string> = {}): Record<string, string> {
  return {
    CLOUDFLARE_API_TOKEN: 'cf-token-abcdef123456',
    CLOUDFLARE_ACCOUNT_ID: 'acct1234567890',
    PRODUCTION_SUPABASE_REF: PROD_REF,
    PRODUCTION_PAGES_PROJECT: 'bellemaretours',
    PRODUCTION_URL: 'https://bellemaretours.com',
    CANONICAL_HOST: 'bellemaretours.com',
    SANDBOX_SUPABASE_URL: `https://${SANDBOX_REF}.supabase.co`,
    SANDBOX_SUPABASE_ANON_KEY: jwt({ ref: SANDBOX_REF, role: 'anon' }),
    SANDBOX_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: SANDBOX_REF, role: 'service_role' }),
    SANDBOX_SUPABASE_JWT_SECRET: JWT_SECRET,
    SANDBOX_INTERNAL_TASK_SECRET: 'internal-task-secret-0123',
    SANDBOX_DB_URL: `postgresql://postgres.${SANDBOX_REF}:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    SANDBOX_PEACH_CLIENT_ID: 'peach-client-id',
    SANDBOX_PEACH_CLIENT_SECRET: 'peach-client-secret-value',
    SANDBOX_PEACH_MERCHANT_ID: 'peach-merchant-id',
    SANDBOX_PEACH_ENTITY_ID: 'peach-entity-id',
    SANDBOX_PEACH_WEBHOOK_SECRET: 'peach-webhook-secret-value',
    SANDBOX_PEACH_CHECKOUT_BASE_URL: 'https://testsecure.peachpayments.com',
    SANDBOX_PEACH_AUTH_BASE_URL: 'https://sandbox-dashboard.peachpayments.com',
    ...over,
  };
}

const without = (env: Record<string, string>, ...names: string[]) => {
  const copy = { ...env };
  for (const n of names) delete copy[n];
  return copy;
};

describe('checkSandboxConfig — a valid sandbox', () => {
  it('passes, defaulting the project name and reporting Peach as configured', () => {
    const r = checkSandboxConfig(validEnv());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.config.project).toBe('belle-mare-sandbox');
    expect(r.config.supabaseRef).toBe(SANDBOX_REF);
    expect(r.config.peachConfigured).toBe(true);
  });

  it('works without Peach keys, warning that checkout cannot complete', () => {
    const env = validEnv();
    for (const k of Object.keys(env)) if (k.startsWith('SANDBOX_PEACH_')) delete env[k];
    const r = checkSandboxConfig(env);
    expect(r.ok).toBe(true);
    expect(r.config.peachConfigured).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/No Peach TEST keys/);
  });

  it('accepts new-style Supabase keys (project not verifiable → a warning, not an error)', () => {
    const r = checkSandboxConfig(
      validEnv({
        SANDBOX_SUPABASE_ANON_KEY: 'sb_publishable_abc123',
        SANDBOX_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc123',
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/new-style Supabase key/);
  });
});

describe('checkSandboxConfig — never the production database', () => {
  it('refuses a Supabase URL that is the production project', () => {
    const r = checkSandboxConfig(
      validEnv({
        SANDBOX_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
        SANDBOX_SUPABASE_ANON_KEY: jwt({ ref: PROD_REF, role: 'anon' }),
        SANDBOX_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD_REF, role: 'service_role' }),
        SANDBOX_DB_URL: `postgresql://postgres.${PROD_REF}:pw@host:5432/postgres`,
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/PRODUCTION Supabase project/);
    expect(r.errors.join('\n')).toMatch(/PRODUCTION database/);
  });

  it('still knows the production ref when the workflow passes no PRODUCTION_* variables at all', () => {
    // The ref is compiled in, so an unset repo variable can never switch the guard off.
    const env = without(
      validEnv({ SANDBOX_SUPABASE_URL: `https://${PROD_REF}.supabase.co` }),
      'PRODUCTION_SUPABASE_REF',
    );
    expect(checkSandboxConfig(env).errors.join('\n')).toMatch(/PRODUCTION Supabase project/);
  });

  it('refuses keys that belong to a DIFFERENT project than the URL (production keys, sandbox URL)', () => {
    const r = checkSandboxConfig(
      validEnv({
        SANDBOX_SUPABASE_ANON_KEY: jwt({ ref: PROD_REF, role: 'anon' }),
        SANDBOX_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD_REF, role: 'service_role' }),
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.filter((e) => /belongs to Supabase project/.test(e))).toHaveLength(2);
  });

  it('refuses swapped anon / service-role keys', () => {
    const r = checkSandboxConfig(
      validEnv({
        SANDBOX_SUPABASE_ANON_KEY: jwt({ ref: SANDBOX_REF, role: 'service_role' }),
        SANDBOX_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: SANDBOX_REF, role: 'anon' }),
      }),
    );
    expect(r.errors.join('\n')).toMatch(/must be a "anon" key/);
    expect(r.errors.join('\n')).toMatch(/must be a "service_role" key/);
  });

  it('refuses a new-style key of the wrong kind', () => {
    const r = checkSandboxConfig(validEnv({ SANDBOX_SUPABASE_ANON_KEY: 'sb_secret_oops' }));
    expect(r.errors.join('\n')).toMatch(/must be a publishable key/);
  });

  it('refuses a database URL for a different project than the Supabase URL', () => {
    const r = checkSandboxConfig(
      validEnv({ SANDBOX_DB_URL: 'postgresql://postgres.zzzzzzzzzzzzzzzzzzzz:pw@h:5432/postgres' }),
    );
    expect(r.errors.join('\n')).toMatch(/not the same Supabase project/);
  });

  it('warns about the IPv6-only direct host (GitHub runners are IPv4-only)', () => {
    const r = checkSandboxConfig(
      validEnv({
        SANDBOX_DB_URL: `postgresql://postgres:pw@db.${SANDBOX_REF}.supabase.co:5432/postgres`,
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/session-pooler/);
  });

  it('warns about the transaction pooler (port 6543), which cannot apply the schema file', () => {
    const r = checkSandboxConfig(
      validEnv({
        SANDBOX_DB_URL: `postgresql://postgres.${SANDBOX_REF}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/port 6543/);
    // …and the recommended session-pooler string on 5432 raises no such warning.
    expect(checkSandboxConfig(validEnv()).warnings.join(' ')).not.toMatch(/6543/);
  });

  it('refuses a Supabase URL that is not a project address', () => {
    const r = checkSandboxConfig(validEnv({ SANDBOX_SUPABASE_URL: 'https://example.com' }));
    expect(r.errors.join('\n')).toMatch(/must look like https:\/\/<project-ref>\.supabase\.co/);
  });
});

describe('checkSandboxConfig — never the production Pages project (or any other site)', () => {
  it('refuses the production project name, however it is spelled', () => {
    for (const name of ['bellemaretours', 'getyourtoursmauritius']) {
      const r = checkSandboxConfig(validEnv({ SANDBOX_PAGES_PROJECT: name }));
      expect(r.ok, name).toBe(false);
    }
  });

  it('requires the project name to contain "sandbox", so a typo cannot overwrite another site', () => {
    const r = checkSandboxConfig(validEnv({ SANDBOX_PAGES_PROJECT: 'my-other-website' }));
    expect(r.errors.join('\n')).toMatch(/must contain the word "sandbox"/);
  });

  it('refuses an invalid Pages project name', () => {
    expect(checkSandboxConfig(validEnv({ SANDBOX_PAGES_PROJECT: 'Belle_Mare_Sandbox' })).ok).toBe(
      false,
    );
    expect(checkSandboxConfig(validEnv({ SANDBOX_PAGES_PROJECT: '-sandbox' })).ok).toBe(false);
  });

  it('accepts another sandbox name', () => {
    const r = checkSandboxConfig(validEnv({ SANDBOX_PAGES_PROJECT: 'belle-mare-sandbox-2' }));
    expect(r.ok).toBe(true);
    expect(r.config.project).toBe('belle-mare-sandbox-2');
  });

  it('refuses a custom site URL on a production host, a non-https URL or localhost', () => {
    for (const url of [
      'https://bellemaretours.com',
      'https://www.bellemaretours.com',
      'http://x.pages.dev',
      'https://localhost',
    ]) {
      expect(checkSandboxConfig(validEnv({ SANDBOX_SITE_URL: url })).ok, url).toBe(false);
    }
    expect(
      checkSandboxConfig(validEnv({ SANDBOX_SITE_URL: 'https://sandbox.example.dev' })).ok,
    ).toBe(true);
  });
});

describe('checkSandboxConfig — never real money', () => {
  it('refuses a live Peach endpoint', () => {
    const r = checkSandboxConfig(
      validEnv({ SANDBOX_PEACH_CHECKOUT_BASE_URL: 'https://secure.peachpayments.com' }),
    );
    expect(r.errors.join('\n')).toMatch(/may be LIVE/);
  });

  it('refuses a Peach environment other than "test"', () => {
    const r = checkSandboxConfig(validEnv({ SANDBOX_PEACH_ENVIRONMENT: 'live' }));
    expect(r.errors.join('\n')).toMatch(/only use "test"/);
    expect(checkSandboxConfig(validEnv({ SANDBOX_PEACH_ENVIRONMENT: 'test' })).ok).toBe(true);
  });

  it('refuses a half-configured Peach group instead of deploying a site that fails at checkout', () => {
    const r = checkSandboxConfig(
      without(validEnv(), 'SANDBOX_PEACH_CLIENT_SECRET', 'SANDBOX_PEACH_ENTITY_ID'),
    );
    expect(r.errors.join('\n')).toMatch(
      /Peach is partly configured; missing: .*SANDBOX_PEACH_CLIENT_SECRET.*SANDBOX_PEACH_ENTITY_ID/,
    );
  });

  it('warns (does not fail) when only the webhook secret is missing', () => {
    const r = checkSandboxConfig(without(validEnv(), 'SANDBOX_PEACH_WEBHOOK_SECRET'));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/WEBHOOK_SECRET/);
  });
});

describe('checkSandboxConfig — completeness', () => {
  it('lists every missing required value by name', () => {
    const r = checkSandboxConfig({
      CLOUDFLARE_API_TOKEN: 'x'.repeat(12),
      CLOUDFLARE_ACCOUNT_ID: 'y'.repeat(12),
    });
    for (const s of SANDBOX_SETTINGS.filter((x) => x.required)) {
      expect(r.errors.join('\n')).toContain(`${s.gh} is missing`);
    }
  });

  it('needs the Cloudflare credentials to deploy, but not to merely check values (the uploader)', () => {
    const env = without(validEnv(), 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID');
    expect(checkSandboxConfig(env).errors.join('\n')).toMatch(/CLOUDFLARE_API_TOKEN/);
    expect(checkSandboxConfig(env, { requireCloudflare: false }).ok).toBe(true);
  });

  it('rejects a value containing a line break (it would inject into the .env file)', () => {
    const r = checkSandboxConfig(
      validEnv({ SANDBOX_SUPABASE_JWT_SECRET: 'abc\nNEXT_PUBLIC_SITE_URL=https://evil' }),
    );
    expect(r.errors.join('\n')).toMatch(/SANDBOX_SUPABASE_JWT_SECRET contains a line break/);
  });

  it('rejects a task secret too short to be one', () => {
    expect(
      checkSandboxConfig(validEnv({ SANDBOX_INTERNAL_TASK_SECRET: 'xk9q-7z' })).errors.join('\n'),
    ).toMatch(/too short/);
  });

  it('never puts a secret value into an error or warning', () => {
    const env = validEnv({
      SANDBOX_SUPABASE_ANON_KEY: jwt({ ref: PROD_REF, role: 'anon' }),
      SANDBOX_PEACH_CHECKOUT_BASE_URL: 'https://secure.peachpayments.com',
      SANDBOX_INTERNAL_TASK_SECRET: 'xk9q-7z',
    });
    const r = checkSandboxConfig(env);
    const text = [...r.errors, ...r.warnings].join('\n');
    for (const secret of [
      env.SANDBOX_SUPABASE_ANON_KEY,
      env.SANDBOX_SUPABASE_SERVICE_ROLE_KEY,
      env.SANDBOX_SUPABASE_JWT_SECRET,
      env.SANDBOX_INTERNAL_TASK_SECRET,
      env.SANDBOX_PEACH_CLIENT_SECRET,
      env.CLOUDFLARE_API_TOKEN,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('settings table', () => {
  it('only ever reads SANDBOX_* names from GitHub, so nothing can fall back to a production value', () => {
    for (const s of SANDBOX_SETTINGS) expect(s.gh.startsWith('SANDBOX_')).toBe(true);
  });

  it('manages no WhatsApp, Telegram, owner-alert or auth-email settings, and only the three redirected-mail ones', () => {
    const forbidden =
      /QUOTE_FROM|OWNER_|WHATSAPP|TELEGRAM|SEND_EMAIL|AUTH_EMAIL|PEACH_EXPECT_LIVE|GOOGLE|GSC/;
    for (const name of MANAGED_RUNTIME_NAMES) expect(name).not.toMatch(forbidden);
    for (const s of SANDBOX_SETTINGS) expect(s.local).not.toMatch(forbidden);
    // Mail is managed, but only as a unit that cannot be used without its redirect inbox
    // (see tests/unit/sandbox-ci-mail.test.ts).
    expect(MANAGED_RUNTIME_NAMES.filter((n) => /RESEND|EMAIL/.test(n)).sort()).toEqual([
      'EMAIL_REDIRECT_TO',
      'RESEND_API_KEY',
      'RESEND_FROM',
    ]);
    // …and read from SANDBOX_-prefixed local names, so a production RESEND_API_KEY in .env.local
    // can never be picked up.
    for (const s of SANDBOX_SETTINGS.filter((x) => /RESEND|EMAIL/.test(x.local))) {
      expect(s.local.startsWith('SANDBOX_'), s.local).toBe(true);
    }
  });
});

describe('helpers', () => {
  it('decodeJwtClaims reads a payload and returns null for anything else', () => {
    expect(decodeJwtClaims(jwt({ ref: 'abc', role: 'anon' }))).toMatchObject({
      ref: 'abc',
      role: 'anon',
    });
    expect(decodeJwtClaims('sb_publishable_x')).toBeNull();
    expect(decodeJwtClaims('a.b.c')).toBeNull();
    expect(decodeJwtClaims(undefined)).toBeNull();
  });

  it('supabaseRefFromUrl extracts a 20-character project ref only', () => {
    expect(supabaseRefFromUrl(`https://${SANDBOX_REF}.supabase.co`)).toBe(SANDBOX_REF);
    expect(supabaseRefFromUrl('https://short.supabase.co')).toBeNull();
    expect(supabaseRefFromUrl('https://example.com')).toBeNull();
    expect(supabaseRefFromUrl('not a url')).toBeNull();
  });

  it('pinWranglerProjectName renames the top-level project and insists on finding it', () => {
    const toml = '# c\nname = "bellemaretours"\ncompatibility_date = "2025-02-01"\n';
    expect(pinWranglerProjectName(toml, 'belle-mare-sandbox')).toContain(
      'name = "belle-mare-sandbox"',
    );
    expect(pinWranglerProjectName(toml, 'belle-mare-sandbox')).not.toContain('bellemaretours');
    expect(() => pinWranglerProjectName('compatibility_date = "x"\n', 'p')).toThrow(
      /no top-level name/,
    );
  });

  it('pins the repo’s real wrangler.toml (the file CI actually edits)', () => {
    const real = readFileSync('wrangler.toml', 'utf8');
    const pinned = pinWranglerProjectName(real, 'belle-mare-sandbox');
    expect(pinned).toContain('name = "belle-mare-sandbox"');
    expect(pinned).not.toMatch(/^name = "bellemaretours"/m);
  });
});

describe('build env', () => {
  const args = {
    supabaseUrl: `https://${SANDBOX_REF}.supabase.co`,
    anonKey: 'anon',
    siteUrl: 'https://belle-mare-sandbox.pages.dev',
  };

  it('bakes in the sandbox identity, switches indexing off and blanks the analytics container', () => {
    const text = renderBuildEnv(args);
    expect(text).toContain(`NEXT_PUBLIC_SUPABASE_URL=https://${SANDBOX_REF}.supabase.co`);
    expect(text).toContain('NEXT_PUBLIC_SITE_URL=https://belle-mare-sandbox.pages.dev');
    expect(text).toContain('NEXT_PUBLIC_SITE_NOINDEX=true');
    // Empty, not absent: absent falls back to the production GTM container.
    expect(text.split('\n')).toContain('NEXT_PUBLIC_GTM_ID=');
    // The production Maps key is restricted to the production domain and must not be baked in.
    expect(text).not.toMatch(/GOOGLE_MAPS/);
  });

  it('refuses a missing value or one containing a line break', () => {
    expect(() => renderBuildEnv({ ...args, anonKey: '' })).toThrow(/anonKey is required/);
    expect(() => renderBuildEnv({ ...args, siteUrl: 'https://a\nB=c' })).toThrow(/line break/);
  });
});

describe('Pages project settings', () => {
  const site = 'https://belle-mare-sandbox.pages.dev';
  const withPeach = () => checkSandboxConfig(validEnv());
  const patchFor = (r: ReturnType<typeof checkSandboxConfig>) =>
    buildPagesConfigPatch({
      values: r.config.values,
      siteUrl: site,
      peachConfigured: r.config.peachConfigured,
    });

  it('matches the compatibility settings in wrangler.toml (the app 500s without nodejs_compat)', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect(toml).toMatch(new RegExp(`compatibility_date\\s*=\\s*"${COMPATIBILITY_DATE}"`));
    for (const flag of COMPATIBILITY_FLAGS) expect(toml).toContain(`"${flag}"`);
    const cfg = patchFor(withPeach()).deployment_configs.production;
    expect(cfg.compatibility_flags).toEqual(['nodejs_compat']);
    expect(cfg.compatibility_date).toBe(COMPATIBILITY_DATE);
  });

  it('stores EVERY runtime setting as a secret — a deploy may overwrite plain variables but never deletes secrets', () => {
    const env = patchFor(withPeach()).deployment_configs.production.env_vars;
    expect(env.SUPABASE_SERVICE_ROLE_KEY?.type).toBe('secret_text');
    expect(env.SUPABASE_JWT_SECRET?.type).toBe('secret_text');
    expect(env.INTERNAL_TASK_SECRET?.type).toBe('secret_text');
    expect(env.PEACH_CLIENT_SECRET?.type).toBe('secret_text');
    expect(env.NEXT_PUBLIC_SUPABASE_URL?.type).toBe('secret_text');
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.type).toBe('secret_text');
    expect(env.PEACH_ENTITY_ID?.type).toBe('secret_text');
    expect(env.PEACH_CHECKOUT_BASE_URL?.type).toBe('secret_text');
    const types = Object.values(env)
      .filter((v) => v !== null)
      .map((v) => v?.type);
    expect(new Set(types)).toEqual(new Set(['secret_text']));
    expect(env.NEXT_PUBLIC_SITE_URL).toEqual({ type: 'secret_text', value: site });
  });

  it('forces Peach TEST mode and points the webhook at the sandbox', () => {
    const env = patchFor(withPeach()).deployment_configs.production.env_vars;
    expect(env.PEACH_ENVIRONMENT).toEqual({ type: 'secret_text', value: 'test' });
    expect(env.PEACH_WEBHOOK_URL?.value).toBe(`${site}/api/v1/webhooks/payments`);
  });

  it('clears a setting that is on the project but no longer provided (null deletes), so removing a secret really removes it', () => {
    const env = { ...validEnv() };
    for (const k of Object.keys(env)) if (k.startsWith('SANDBOX_PEACH_')) delete env[k];
    const r = checkSandboxConfig(env);
    const vars = buildPagesConfigPatch({
      values: r.config.values,
      siteUrl: site,
      peachConfigured: r.config.peachConfigured,
      existingNames: [
        'PEACH_CLIENT_ID',
        'PEACH_ENVIRONMENT',
        'PEACH_WEBHOOK_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
      ],
    }).deployment_configs.production.env_vars;
    expect(vars.PEACH_CLIENT_ID).toBeNull();
    expect(vars.PEACH_ENVIRONMENT).toBeNull();
    expect(vars.PEACH_WEBHOOK_URL).toBeNull();
    // Still provided, so it is set, not deleted.
    expect(vars.SUPABASE_SERVICE_ROLE_KEY).toMatchObject({ type: 'secret_text' });
  });

  it('sends no deletion for a name that is not on the project (a new project has none)', () => {
    const env = { ...validEnv() };
    for (const k of Object.keys(env)) if (k.startsWith('SANDBOX_PEACH_')) delete env[k];
    const vars = patchFor(checkSandboxConfig(env)).deployment_configs.production.env_vars;
    expect(Object.values(vars).some((v) => v === null)).toBe(false);
    expect(vars.PEACH_CLIENT_ID).toBeUndefined();
  });

  it('only ever mentions names it owns — even when told about names it does not', () => {
    const managed = new Set(MANAGED_RUNTIME_NAMES);
    const r = withPeach();
    const plain = Object.keys(patchFor(r).deployment_configs.production.env_vars);
    expect(plain.length).toBeGreaterThan(0);
    for (const name of plain) expect(managed.has(name), name).toBe(true);
    // A hand-set dashboard value the tool does not own is never touched, even if it exists.
    const withForeign = buildPagesConfigPatch({
      values: r.config.values,
      siteUrl: site,
      peachConfigured: r.config.peachConfigured,
      existingNames: [
        'WHATSAPP_ACCESS_TOKEN',
        'SOMETHING_THE_OWNER_ADDED',
        ...MANAGED_RUNTIME_NAMES,
      ],
    });
    const names = Object.keys(withForeign.deployment_configs.production.env_vars);
    expect(names).not.toContain('WHATSAPP_ACCESS_TOKEN');
    expect(names).not.toContain('SOMETHING_THE_OWNER_ADDED');
    expect(names.sort()).toEqual([...MANAGED_RUNTIME_NAMES].sort());
  });
});

describe('checkSandboxConfig — the JWT secret must be this project’s own', () => {
  it('passes when the secret signs the project’s keys', () => {
    expect(checkSandboxConfig(validEnv()).errors).toEqual([]);
  });

  it('is optional: a project on asymmetric signing keys (the sandbox uses ES256) never reads one', () => {
    const r = checkSandboxConfig(without(validEnv(), 'SANDBOX_SUPABASE_JWT_SECRET'));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    // …and with none set, nothing is sent to the Pages project for it either.
    const vars = buildPagesConfigPatch({
      values: r.config.values,
      siteUrl: 'https://belle-mare-sandbox.pages.dev',
      peachConfigured: r.config.peachConfigured,
    }).deployment_configs.production.env_vars;
    expect(vars.SUPABASE_JWT_SECRET).toBeUndefined();
  });

  it('refuses a secret that signs nothing here (e.g. the production project’s), without printing it', () => {
    const wrong = 'the-production-projects-secret-xyz';
    const r = checkSandboxConfig(validEnv({ SANDBOX_SUPABASE_JWT_SECRET: wrong }));
    expect(r.ok).toBe(false);
    const text = r.errors.join('\n');
    expect(text).toMatch(
      /does not sign SANDBOX_SUPABASE_ANON_KEY \/ SANDBOX_SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(text).toMatch(/may belong to another project/);
    expect(text + r.warnings.join('\n')).not.toContain(wrong);
  });

  it('names only the key that does not match when one of them is stale', () => {
    const r = checkSandboxConfig(
      validEnv({
        SANDBOX_SUPABASE_SERVICE_ROLE_KEY: jwt(
          { ref: SANDBOX_REF, role: 'service_role' },
          'an-older-rotated-secret-0000',
        ),
      }),
    );
    expect(r.errors.join('\n')).toMatch(/does not sign SANDBOX_SUPABASE_SERVICE_ROLE_KEY —/);
    expect(r.errors.join('\n')).not.toMatch(/does not sign SANDBOX_SUPABASE_ANON_KEY/);
  });

  it('can only warn when the keys are new-style (there is no signature to check)', () => {
    const r = checkSandboxConfig(
      validEnv({
        SANDBOX_SUPABASE_ANON_KEY: 'sb_publishable_abc',
        SANDBOX_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc',
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/could not be checked against the project/);
  });
});

describe('jwtSecretMatchesToken', () => {
  const token = jwt({ ref: SANDBOX_REF, role: 'anon' });

  it('says match for the signing secret and mismatch for any other', () => {
    expect(jwtSecretMatchesToken(token, JWT_SECRET)).toBe('match');
    expect(jwtSecretMatchesToken(token, JWT_SECRET + 'x')).toBe('mismatch');
  });

  it('is unverifiable for anything that is not an HS256 JWT, or with no secret', () => {
    expect(jwtSecretMatchesToken('sb_publishable_abc', JWT_SECRET)).toBe('unverifiable');
    expect(jwtSecretMatchesToken('a.b.c', JWT_SECRET)).toBe('unverifiable');
    expect(jwtSecretMatchesToken(undefined, JWT_SECRET)).toBe('unverifiable');
    expect(jwtSecretMatchesToken(token, '')).toBe('unverifiable');
    const rs256 = `${b64({ alg: 'RS256' })}.${b64({ ref: SANDBOX_REF })}.sig`;
    expect(jwtSecretMatchesToken(rs256, JWT_SECRET)).toBe('unverifiable');
  });
});

describe('evaluateHealth', () => {
  const ok = (over: Record<string, unknown> = {}, checks: Record<string, boolean> = {}) => ({
    ok: true,
    data: {
      status: 'ok',
      live: false,
      releaseSha: 'abc',
      checks: {
        supabaseConfigured: true,
        serviceRoleConfigured: true,
        siteUrlConfigured: true,
        paymentsSafe: true,
        internalTasksConfigured: true,
        database: true,
        ...checks,
      },
      ...over,
    },
  });

  it('passes a healthy sandbox', () => {
    expect(evaluateHealth(ok(), 'abc')).toEqual({ fatal: [], warnings: [] });
  });

  it('treats a 503 whose only failing check is payments as a WARNING (Peach keys not set yet)', () => {
    const body = {
      ok: false,
      error: {
        code: 'unhealthy',
        details: ok({ status: 'degraded' }, { paymentsSafe: false }).data,
      },
    };
    const r = evaluateHealth(body, 'abc');
    expect(r.fatal).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/payments are unavailable/);
  });

  it('is FATAL when Peach keys were configured but payments are still unavailable (a green run must not hide a dead checkout)', () => {
    const body = {
      ok: false,
      error: {
        code: 'unhealthy',
        details: ok({ status: 'degraded' }, { paymentsSafe: false }).data,
      },
    };
    const r = evaluateHealth(body, 'abc', { peachConfigured: true });
    expect(r.fatal.join(' ')).toMatch(/although Peach TEST keys were configured/);
    // …and the very same response is only a warning when nobody configured Peach.
    expect(evaluateHealth(body, 'abc', { peachConfigured: false }).fatal).toEqual([]);
  });

  it('is fatal when the deployed site has no internal task secret', () => {
    const r = evaluateHealth(ok({}, { internalTasksConfigured: false }), 'abc');
    expect(r.fatal.join(' ')).toMatch(/INTERNAL_TASK_SECRET/);
  });

  it('is fatal when the database or Supabase configuration is broken', () => {
    expect(evaluateHealth(ok({}, { database: false }), 'abc').fatal.join(' ')).toMatch(/database/);
    expect(evaluateHealth(ok({}, { supabaseConfigured: false }), 'abc').fatal.join(' ')).toMatch(
      /supabaseConfigured/,
    );
  });

  it('is fatal if the sandbox ever reports LIVE payment mode', () => {
    expect(evaluateHealth(ok({ live: true }), 'abc').fatal.join(' ')).toMatch(/LIVE payment mode/);
  });

  it('warns on a stale release SHA and is fatal on a non-report', () => {
    expect(evaluateHealth(ok({ releaseSha: 'old' }), 'abc').warnings.join(' ')).toMatch(
      /releaseSha/,
    );
    expect(evaluateHealth({ ok: false }, 'abc').fatal.length).toBe(1);
    expect(evaluateHealth(null, 'abc').fatal.length).toBe(1);
  });
});

/** A fake fetch that records calls and answers from a script. */
function fakeFetch(
  answers: Array<{ status: number; body: unknown } | { raw: string; status: number }>,
) {
  const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
  const impl = async (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      auth: init.headers?.Authorization ?? null,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const a = answers.shift();
    if (!a) throw new Error('unexpected extra request');
    const text = 'raw' in a ? a.raw : JSON.stringify(a.body);
    return { status: a.status, ok: a.status >= 200 && a.status < 300, text: async () => text };
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('ensureProject', () => {
  const base = { token: 'cf-token-abcdef123456', accountId: 'acct', project: 'belle-mare-sandbox' };

  it('uses an existing direct-upload project and reports its stable address', async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: {
          success: true,
          result: { subdomain: 'belle-mare-sandbox.pages.dev', production_branch: 'main' },
        },
      },
    ]);
    const r = await ensureProject({ ...base, fetchImpl: f.impl });
    expect(r).toEqual({
      created: false,
      subdomain: 'belle-mare-sandbox.pages.dev',
      branch: 'main',
      envNames: [],
    });
    expect(f.calls[0]).toMatchObject({
      method: 'GET',
      url: expect.stringContaining('/accounts/acct/pages/projects/belle-mare-sandbox'),
      auth: `Bearer ${base.token}`,
    });
  });

  it('reports the names of the settings already on an existing project (never their values)', async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: {
          success: true,
          result: {
            subdomain: 'belle-mare-sandbox.pages.dev',
            production_branch: 'main',
            deployment_configs: {
              production: {
                env_vars: {
                  SUPABASE_SERVICE_ROLE_KEY: { type: 'secret_text' },
                  PEACH_CLIENT_ID: { type: 'secret_text' },
                },
              },
            },
          },
        },
      },
    ]);
    const r = await ensureProject({ ...base, fetchImpl: f.impl });
    expect(r.envNames.sort()).toEqual(['PEACH_CLIENT_ID', 'SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('creates the project (direct upload, no Git link) when it does not exist, and returns the REAL subdomain', async () => {
    const f = fakeFetch([
      {
        status: 404,
        body: { success: false, errors: [{ code: 8000007, message: 'Project not found' }] },
      },
      {
        status: 200,
        body: {
          success: true,
          result: { subdomain: 'belle-mare-sandbox-x1y.pages.dev', production_branch: 'main' },
        },
      },
    ]);
    const r = await ensureProject({ ...base, fetchImpl: f.impl });
    expect(r).toEqual({
      created: true,
      subdomain: 'belle-mare-sandbox-x1y.pages.dev',
      branch: 'main',
      envNames: [],
    });
    expect(f.calls[1]?.method).toBe('POST');
    expect(f.calls[1]?.body).toEqual({ name: 'belle-mare-sandbox', production_branch: 'main' });
  });

  it('refuses a project that is connected to Git (its auto-deploy would race this workflow)', async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: { success: true, result: { subdomain: 'x.pages.dev', source: { type: 'github' } } },
      },
    ]);
    await expect(ensureProject({ ...base, fetchImpl: f.impl })).rejects.toThrow(/connected to Git/);
  });

  it('surfaces an API error without leaking the token', async () => {
    const f = fakeFetch([
      {
        status: 403,
        body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
      },
    ]);
    const err = (await ensureProject({ ...base, fetchImpl: f.impl }).catch(
      (e: unknown) => e as Error,
    )) as Error;
    expect(String(err.message)).toMatch(/403/);
    expect(String(err.message)).not.toContain(base.token);
  });

  it('redacts secrets echoed back in a non-JSON response', async () => {
    const f = fakeFetch([
      { status: 502, raw: `<html>bad gateway for ${base.token}</html>` },
      { status: 502, raw: `<html>${base.token}</html>` },
      { status: 502, raw: `<html>${base.token}</html>` },
    ]);
    const err = (await ensureProject({
      ...base,
      secrets: [base.token],
      fetchImpl: f.impl,
      retryDelayMs: 0,
    }).catch((e: unknown) => e as Error)) as Error;
    expect(String(err.message)).toMatch(/non-JSON/);
    expect(String(err.message)).not.toContain(base.token);
  });
});

describe('syncProjectConfig', () => {
  const base = { token: 'cf-token-abcdef123456', accountId: 'acct', project: 'belle-mare-sandbox' };
  const patch = buildPagesConfigPatch({
    values: checkSandboxConfig(validEnv()).config.values,
    siteUrl: 'https://belle-mare-sandbox.pages.dev',
    peachConfigured: true,
  });
  const wanted = patch.deployment_configs.production.env_vars as Record<string, unknown>;
  const liveFrom = (skip: string[] = []) =>
    Object.fromEntries(
      Object.entries(wanted)
        .filter(([k, v]) => v !== null && !skip.includes(k))
        .map(([k, v]) => [k, v]),
    );

  it('sends the patch, reads the project back and confirms every value landed', async () => {
    const f = fakeFetch([
      { status: 200, body: { success: true, result: {} } },
      {
        status: 200,
        body: {
          success: true,
          result: { deployment_configs: { production: { env_vars: liveFrom() } } },
        },
      },
    ]);
    const r = await syncProjectConfig({ ...base, patch, fetchImpl: f.impl });
    expect(f.calls[0]?.method).toBe('PATCH');
    expect(f.calls[0]?.body).toEqual(patch);
    expect(r.set).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(r.set).toContain('NEXT_PUBLIC_SITE_NOINDEX');
  });

  it('fails loudly when Cloudflare silently dropped a value', async () => {
    const f = fakeFetch([
      { status: 200, body: { success: true, result: {} } },
      {
        status: 200,
        body: {
          success: true,
          result: {
            deployment_configs: { production: { env_vars: liveFrom(['INTERNAL_TASK_SECRET']) } },
          },
        },
      },
    ]);
    await expect(syncProjectConfig({ ...base, patch, fetchImpl: f.impl })).rejects.toThrow(
      /missing: .*INTERNAL_TASK_SECRET/,
    );
  });

  it('copes with a brand-new project that has no environment variables yet (null)', async () => {
    const f = fakeFetch([
      { status: 200, body: { success: true, result: {} } },
      {
        status: 200,
        body: { success: true, result: { deployment_configs: { production: { env_vars: null } } } },
      },
    ]);
    await expect(syncProjectConfig({ ...base, patch, fetchImpl: f.impl })).rejects.toThrow(
      /did not take the settings/,
    );
  });

  it('surfaces a rejected update', async () => {
    const f = fakeFetch([
      {
        status: 400,
        body: { success: false, errors: [{ code: 8000000, message: 'bad request' }] },
      },
    ]);
    await expect(syncProjectConfig({ ...base, patch, fetchImpl: f.impl })).rejects.toThrow(
      /updating Pages project/,
    );
  });
});
