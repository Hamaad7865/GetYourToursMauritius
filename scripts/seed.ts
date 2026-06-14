import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';

/** Validates seed/catalogue.json and (re)generates supabase/seed.sql. */
const root = process.cwd();
const raw: unknown = JSON.parse(readFileSync(join(root, 'seed', 'catalogue.json'), 'utf8'));
const catalogue = catalogueSchema.parse(raw);
const sql = catalogueToSeedSql(catalogue);
const out = `-- GENERATED from seed/catalogue.json by \`npm run seed:gen\`. Do not edit by hand.\n-- Apply on a fresh database via \`supabase db reset\` (it runs migrations then this file).\n\n${sql}\n`;
writeFileSync(join(root, 'supabase', 'seed.sql'), out, 'utf8');
console.log(`Wrote supabase/seed.sql (${catalogue.activities.length} activities)`);
