import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SANDBOX_SETTINGS } from '../../scripts/sandbox/ci.mjs';

/**
 * .github/workflows/sandbox.yml publishes a public site using credentials, in a repo whose defaults
 * all point at production. The guard rails in scripts/sandbox/ci.mjs are unit-tested on their own;
 * this pins the properties of the WORKFLOW FILE that make them effective — so a later edit cannot
 * quietly hand a secret to the build, deploy on `main`, or read a production value.
 */
const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as { load: (text: string) => Record<string, any> };

const RAW = readFileSync('.github/workflows/sandbox.yml', 'utf8');
const wf = yaml.load(RAW);
const job = wf.jobs.deploy;
const steps: Array<Record<string, any>> = job.steps;
const stepNamed = (fragment: string) => {
  const s = steps.find((x) => String(x.name ?? '').includes(fragment));
  if (!s) throw new Error(`no step named like "${fragment}"`);
  return s;
};
const indexOfStep = (fragment: string) => steps.indexOf(stepNamed(fragment));
const withoutComments = RAW.split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');
const expressions = [...withoutComments.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map(
  (m) => m[1] ?? '',
);
const secretsUsed = (env: Record<string, string> = {}) =>
  Object.values(env).filter((v) => /\bsecrets\./.test(String(v)));

describe('sandbox.yml — triggers and scope', () => {
  it('runs only on a push to the `sandbox` branch (or by hand) — never on main or a pull request', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(wf.on.push.branches).toEqual(['sandbox']);
  });

  it('has read-only permissions, no production environment and its own concurrency group', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(job.environment).toBeUndefined();
    expect(wf.concurrency.group).toBe('sandbox-deploy');
    expect(wf.concurrency.group).not.toMatch(/production/);
  });

  it('only runs in this repository', () => {
    expect(job.if).toContain("github.repository == 'Hamaad7865/GetYourToursMauritius'");
  });

  it('pins every action to a full commit SHA', () => {
    const uses = steps.map((s) => s.uses).filter(Boolean) as string[];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe('sandbox.yml — never reads a production value', () => {
  const ALLOWED_VARS = [
    'CLOUDFLARE_PAGES_PROJECT',
    'SUPABASE_PROJECT_ID',
    'PRODUCTION_URL',
    'CANONICAL_HOST',
  ];
  const ALLOWED_SECRETS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];

  it('every variable and secret is a SANDBOX_* name or one of the few production-IDENTITY values', () => {
    const vars = expressions.filter((e) => e.startsWith('vars.')).map((e) => e.slice(5));
    const secrets = expressions.filter((e) => e.startsWith('secrets.')).map((e) => e.slice(8));
    expect(vars.length).toBeGreaterThan(0);
    for (const v of vars)
      expect(v.startsWith('SANDBOX_') || ALLOWED_VARS.includes(v), `vars.${v}`).toBe(true);
    for (const s of secrets)
      expect(s.startsWith('SANDBOX_') || ALLOWED_SECRETS.includes(s), `secrets.${s}`).toBe(true);
  });

  it('never references the production Supabase, site URL, database or payment-probe settings', () => {
    for (const forbidden of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SITE_URL',
      'SUPABASE_DB_URL',
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_DB_PASSWORD',
      'PAYMENT_SMOKE',
    ]) {
      expect(
        expressions.some((e) => new RegExp(`(vars|secrets)\\.${forbidden}\\b`).test(e)),
        forbidden,
      ).toBe(false);
    }
  });

  it('uses the production-identity values only as inputs to the guard rails (PRODUCTION_* / CANONICAL_HOST)', () => {
    for (const s of steps) {
      for (const [key, value] of Object.entries<string>(s.env ?? {})) {
        if (ALLOWED_VARS.some((v) => String(value).includes(`vars.${v}`))) {
          expect(
            key.startsWith('PRODUCTION_') || key === 'CANONICAL_HOST',
            `${s.name}: ${key}`,
          ).toBe(true);
        }
      }
    }
  });

  it('sends no email, WhatsApp or owner-alert settings anywhere', () => {
    expect(withoutComments).not.toMatch(
      /RESEND|WHATSAPP|TELEGRAM|OWNER_NOTIFY|QUOTE_FROM|SEND_EMAIL/,
    );
  });
});

describe('sandbox.yml — secrets reach only the steps that need them', () => {
  it('gives no secret to the install, the build, the release metadata or the source-map steps', () => {
    for (const fragment of [
      'Install',
      'Write release metadata',
      'Edge bundle',
      'Keep source maps',
    ]) {
      const s = stepNamed(fragment);
      expect(secretsUsed(s.env), `${s.name}`).toEqual([]);
    }
  });

  it('gives the Cloudflare token to exactly two steps: the guard-rails step and the deploy', () => {
    const holders = steps
      .filter((s) => s.env && 'CLOUDFLARE_API_TOKEN' in s.env)
      .map((s) => String(s.name));
    expect(holders).toHaveLength(2);
    expect(holders.some((n) => n.includes('Guard rails'))).toBe(true);
    expect(holders.some((n) => n.includes('Deploy to Cloudflare Pages'))).toBe(true);
  });

  it('hands the build-env step only the two public Supabase values (plus the URL and the guard input)', () => {
    const env = stepNamed('build-time .env').env as Record<string, string>;
    expect(Object.keys(env).sort()).toEqual([
      'PRODUCTION_SUPABASE_REF',
      'SANDBOX_RESOLVED_SITE_URL',
      'SANDBOX_SUPABASE_ANON_KEY',
      'SANDBOX_SUPABASE_URL',
    ]);
  });
});

describe('sandbox.yml — order and deploy target', () => {
  it('runs the guard rails first, before the install and the build', () => {
    const order = [
      'Guard rails',
      'Install',
      'build-time .env',
      'Edge bundle',
      'Verify NEXT_PUBLIC',
      'Sync the sandbox database',
      'Point this workspace',
      'Deploy to Cloudflare Pages',
      'Health check',
    ].map(indexOfStep);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[0]).toBe(steps.findIndex((s) => s.uses === undefined));
  });

  it('deploys to the resolved sandbox project, by name, on that project’s production branch', () => {
    const deploy = stepNamed('Deploy to Cloudflare Pages');
    expect(deploy.run).toContain('--project-name "$SANDBOX_PROJECT"');
    expect(deploy.run).toContain('--branch "$SANDBOX_BRANCH"');
    expect(deploy.env.SANDBOX_PROJECT).toBe('${{ steps.sandbox.outputs.project }}');
    expect(RAW.replace(/^\s*#.*$/gm, '')).not.toMatch(/bellemaretours|getyourtoursmauritius/);
  });

  it('pins the workspace wrangler.toml to the sandbox project right before deploying', () => {
    expect(indexOfStep('Point this workspace')).toBe(indexOfStep('Deploy to Cloudflare Pages') - 1);
  });

  it('syncs the database with the SANDBOX connection string, never the production one', () => {
    const sync = stepNamed('Sync the sandbox database');
    expect(sync.env).toEqual({ SUPABASE_DB_URL: '${{ secrets.SANDBOX_DB_URL }}' });
  });
});

describe('sandbox.yml — stays in step with the settings table', () => {
  const guard = stepNamed('Guard rails');

  it('reads every SANDBOX_* setting from the same place the uploader writes it (secret vs variable)', () => {
    for (const s of SANDBOX_SETTINGS) {
      const expr = guard.env[s.gh];
      expect(expr, `${s.gh} is missing from the guard-rails step`).toBeDefined();
      const wanted = s.kind === 'secret' ? 'secrets' : 'vars';
      expect(expr, s.gh).toBe(`\${{ ${wanted}.${s.gh} }}`);
    }
  });

  it('also passes the optional project name and site URL, as variables', () => {
    expect(guard.env.SANDBOX_PAGES_PROJECT).toBe('${{ vars.SANDBOX_PAGES_PROJECT }}');
    expect(guard.env.SANDBOX_SITE_URL).toBe('${{ vars.SANDBOX_SITE_URL }}');
  });
});

describe('sandbox.yml — the health check knows whether Peach was configured', () => {
  it('passes the resolve step’s peach_configured output to the health step', () => {
    const env = stepNamed('Health check').env as Record<string, string>;
    expect(env.SANDBOX_PEACH_CONFIGURED).toBe('${{ steps.sandbox.outputs.peach_configured }}');
    expect(env.SANDBOX_RESOLVED_SITE_URL).toBe('${{ steps.sandbox.outputs.site_url }}');
  });

  it('the script really emits that output', () => {
    expect(readFileSync('scripts/sandbox/ci.mjs', 'utf8')).toContain(
      "setOutput('peach_configured'",
    );
  });
});

describe('sandbox.yml — the scripts it runs exist', () => {
  it('every scripts/*.mjs path in a run step is a real file', () => {
    const paths = [...withoutComments.matchAll(/scripts\/[\w./-]+\.mjs/g)].map((m) => m[0]);
    expect(paths.length).toBeGreaterThan(4);
    for (const p of new Set(paths)) expect(existsSync(p), p).toBe(true);
  });

  it('every ci.mjs subcommand it calls is one the script implements', () => {
    const src = readFileSync('scripts/sandbox/ci.mjs', 'utf8');
    const called = [...withoutComments.matchAll(/scripts\/sandbox\/ci\.mjs\s+([a-z-]+)/g)].map(
      (m) => m[1],
    );
    expect(called.length).toBeGreaterThan(3);
    for (const c of new Set(called)) expect(src, c).toContain(`case '${c}':`);
  });
});
