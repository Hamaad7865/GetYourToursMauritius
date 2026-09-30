/**
 * Sets a Supabase auth user's password on the project .env.local points to, then verifies the
 * new password can actually sign in.
 *
 *   npx tsx scripts/sandbox/set-password.ts <email> <new-password>
 *
 * Uses the service-role key — handle the output like a secret.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npx tsx scripts/sandbox/set-password.ts <email> <new-password>');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

const env = { ...loadEnvLocal(), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error(
    'Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local',
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Find the user (paged listUsers — there is no get-by-email call).
let userId: string | null = null;
for (let page = 1; page <= 20 && !userId; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) {
    console.error('listUsers failed:', error.message);
    process.exit(1);
  }
  const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (match) userId = match.id;
  if (data.users.length < 1000) break;
}
if (!userId) {
  console.error(`No auth user found for ${email} on ${url}`);
  process.exit(1);
}

const { error } = await admin.auth.admin.updateUserById(userId, { password });
if (error) {
  console.error('updateUserById failed:', error.message);
  process.exit(1);
}
console.log(`✓ password updated for ${email} (id ${userId})`);

// Verify the new password works end-to-end.
const anon = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const check = await anon.auth.signInWithPassword({ email, password });
if (check.error) {
  console.error('✗ verification sign-in failed:', check.error.message);
  process.exit(1);
}
console.log('✓ verification sign-in succeeded');
