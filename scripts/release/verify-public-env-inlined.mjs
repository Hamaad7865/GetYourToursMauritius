#!/usr/bin/env node
// Fails the build unless the load-bearing NEXT_PUBLIC_* values were actually INLINED into the built
// client bundle.
//
// WHY THIS EXISTS: Next.js substitutes NEXT_PUBLIC_* into client JS at BUILD time. When Cloudflare
// Pages ran the build, its project env vars supplied them for free. Once CI became the builder and
// Pages only served the artifact, CI had none of them set — so the browser bundle shipped with
// `undefined`, every page died behind the React error boundary ("Something went wrong"), and
// /api/v1/health STILL reported supabaseConfigured:true because the SERVER runtime had the vars.
// That combination took the live site down and no existing check noticed.
//
// So this asserts against the built OUTPUT, not the environment: it greps the emitted chunks for
// the real values. A var that is set in the environment but somehow not inlined still fails here.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Values that MUST appear in the client bundle for the app to function in a browser. */
const REQUIRED = [
  { env: 'NEXT_PUBLIC_SUPABASE_URL', why: 'browser Supabase client (auth, cart, wishlist)' },
  { env: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', why: 'browser Supabase client (auth, cart, wishlist)' },
];

/** Recursively collect .js files under a directory. */
function jsFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) jsFiles(p, acc);
    else if (entry.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function main() {
  // Prefer the edge bundle (what actually ships); fall back to the Next client chunks.
  const roots = ['.vercel/output/static/_next/static', '.next/static'].filter((d) => existsSync(d));
  if (roots.length === 0) {
    throw new Error(
      'No built client output found (.vercel/output/static or .next) — run the build first',
    );
  }
  const files = roots.flatMap((r) => jsFiles(r));
  if (files.length === 0) throw new Error(`No .js chunks found under: ${roots.join(', ')}`);

  const haystack = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const missing = [];

  for (const { env, why } of REQUIRED) {
    const value = process.env[env];
    if (!value) {
      missing.push(`${env} is not set in the build environment — needed for: ${why}`);
      continue;
    }
    if (!haystack.includes(value)) {
      missing.push(`${env} is set but was NOT inlined into the client bundle — needed for: ${why}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `NEXT_PUBLIC_* not present in the client bundle:\n  - ${missing.join('\n  - ')}\n\n` +
        `The browser build is broken — every page would fail behind the error boundary while\n` +
        `/api/v1/health still reported healthy. Set these in the repo's Actions secrets/variables\n` +
        `and make sure ci.yml passes them to BOTH the "Build" and "Edge bundle" steps.`,
    );
  }

  console.log(
    `✓ NEXT_PUBLIC_* inlined into the client bundle (${REQUIRED.map((r) => r.env).join(', ')}; ${files.length} chunks scanned)`,
  );
}

try {
  main();
} catch (err) {
  console.error(`✗ verify-public-env-inlined failed: ${err.message}`);
  process.exit(1);
}
