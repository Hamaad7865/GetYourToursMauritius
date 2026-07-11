/**
 * Runs one or more SQL files against the Supabase DB (SUPABASE_DB_URL in .env.local),
 * in order, each in its own transaction. Use for incremental migrations/patches:
 *   npx tsx scripts/db-exec.ts supabase/migrations/X.sql supabase/patches/Y.sql
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const root = process.cwd();

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(root, '.env.local');
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

function buildClientConfig(url: string): pg.ClientConfig {
  const m = url.match(/^postgres(?:ql)?:\/\/(.+)$/i);
  if (!m) throw new Error('SUPABASE_DB_URL must start with postgres:// or postgresql://');
  const rest = m[1]!;
  const at = rest.lastIndexOf('@');
  const creds = rest.slice(0, at);
  let hostPart = rest.slice(at + 1);
  const colon = creds.indexOf(':');
  const user = colon === -1 ? creds : creds.slice(0, colon);
  const password = colon === -1 ? '' : creds.slice(colon + 1);
  let database = 'postgres';
  const slash = hostPart.indexOf('/');
  if (slash !== -1) {
    database = hostPart.slice(slash + 1).split('?')[0] || 'postgres';
    hostPart = hostPart.slice(0, slash);
  }
  const [host, portStr] = hostPart.split(':');
  return {
    host,
    port: portStr ? Number(portStr) : 5432,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
  };
}

const env = { ...loadEnvLocal(), ...process.env };
const url = env.SUPABASE_DB_URL;
if (!url) {
  console.error('Missing SUPABASE_DB_URL in .env.local');
  process.exit(1);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: tsx scripts/db-exec.ts <file.sql> [<file2.sql> ...]');
  process.exit(1);
}

const client = new pg.Client(buildClientConfig(url));

try {
  await client.connect();
  for (const file of files) {
    const sql = readFileSync(join(root, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('commit');
      console.log(`✓ ${file}`);
    } catch (e) {
      await client.query('rollback');
      const err = e as { message?: string; position?: string };
      console.error(`✗ ${file}: ${err.message ?? e}`);
      process.exitCode = 1;
      break;
    }
  }
} catch (e) {
  console.error('✗ connection:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end();
}
