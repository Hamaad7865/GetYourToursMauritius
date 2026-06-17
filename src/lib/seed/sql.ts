import type { Catalogue } from './schema';

/**
 * Pure catalogue → SQL generator. The output is written to supabase/seed.sql
 * (applied on a real Supabase via `supabase db reset`) AND executed against
 * PGlite in tests, so the same statements that seed production are verified.
 *
 * Intended for a fresh/reset database. Operators, activities and translations use
 * ON CONFLICT guards; options/prices/occurrences assume an empty catalogue.
 */

function sqlStr(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNum(value: number | null | undefined): string {
  return value === null || value === undefined ? 'null' : String(value);
}

function sqlBool(value: boolean): string {
  return value ? 'true' : 'false';
}

function sqlTextArray(values: string[]): string {
  if (values.length === 0) return `'{}'::text[]`;
  return `array[${values.map(sqlStr).join(', ')}]::text[]`;
}

export function catalogueToSeedSql(catalogue: Catalogue): string {
  const { operator, activities } = catalogue;
  const lines: string[] = [];

  const opRef = `(select id from operators where slug = ${sqlStr(operator.slug)})`;
  lines.push(
    `insert into operators (name, slug, contact_email, phone) values (` +
      `${sqlStr(operator.name)}, ${sqlStr(operator.slug)}, ${sqlStr(operator.contact_email)}, ${sqlStr(operator.phone)}` +
      `) on conflict (slug) do nothing;`,
  );

  for (const a of activities) {
    const actRef = `(select id from activities where slug = ${sqlStr(a.slug)})`;

    lines.push(
      `insert into activities (operator_id, slug, type, title, summary, description, category, location, ` +
        `duration_minutes, meeting_point, pickup_available, languages, inclusions, exclusions, highlights, status, ` +
        `pricing_mode) values (` +
        `${opRef}, ${sqlStr(a.slug)}, ${sqlStr(a.type)}, ${sqlStr(a.title)}, ${sqlStr(a.summary)}, ${sqlStr(a.description)}, ` +
        `${sqlStr(a.category)}, ${sqlStr(a.location)}, ${sqlNum(a.duration_minutes)}, ${sqlStr(a.meeting_point)}, ` +
        `${sqlBool(a.pickup_available)}, ${sqlTextArray(['en', 'fr'])}, ${sqlTextArray(a.inclusions)}, ` +
        `${sqlTextArray(a.exclusions)}, ${sqlTextArray(a.highlights)}, ${sqlStr(a.status)}, ${sqlStr(a.pricing_mode)}` +
        `) on conflict (slug) do nothing;`,
    );

    // English primary content also stored as an `en` translation row for uniform lookups.
    lines.push(
      `insert into activity_translations (activity_id, locale, title, summary) values (` +
        `${actRef}, 'en', ${sqlStr(a.title)}, ${sqlStr(a.summary)}) on conflict (activity_id, locale) do nothing;`,
    );
    if (a.fr) {
      lines.push(
        `insert into activity_translations (activity_id, locale, title, summary) values (` +
          `${actRef}, 'fr', ${sqlStr(a.fr.title)}, ${sqlStr(a.fr.summary ?? null)}) on conflict (activity_id, locale) do nothing;`,
      );
    }

    for (const o of a.options) {
      lines.push(
        `insert into activity_options (activity_id, name) values (${actRef}, ${sqlStr(o.name)});`,
      );
      const optRef =
        `(select id from activity_options where activity_id = ${actRef} and name = ${sqlStr(o.name)} ` +
        `order by created_at limit 1)`;
      for (const p of o.prices) {
        lines.push(
          `insert into activity_option_prices (activity_option_id, label, amount_minor, currency, max_guests) values (` +
            `${optRef}, ${sqlStr(p.label)}, ${sqlNum(p.amount_minor)}, 'EUR', ${sqlNum(p.max_guests)});`,
        );
      }
    }

    for (const img of a.images) {
      lines.push(
        `insert into activity_images (activity_id, url, alt, position) values (` +
          `${actRef}, ${sqlStr(img.url)}, ${sqlStr(img.alt)}, ${sqlNum(img.position)});`,
      );
    }
  }

  // Sample bookable inventory: 7 daily 09:00 (Mauritius local) departures for every
  // option that has a price. Anchored to 'Indian/Mauritius' so the stored timestamptz
  // is the correct UTC instant regardless of the server's session timezone. Idempotent
  // via ON CONFLICT on the (activity_option_id, starts_at) unique constraint.
  lines.push(
    `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity) ` +
      `select o.id, a.operator_id, gs, gs + interval '4 hours', 20 ` +
      `from activity_options o ` +
      `join activities a on a.id = o.activity_id ` +
      `cross join generate_series(` +
      `((current_date + 1)::timestamp + time '09:00') at time zone 'Indian/Mauritius', ` +
      `((current_date + 7)::timestamp + time '09:00') at time zone 'Indian/Mauritius', ` +
      `interval '1 day') gs ` +
      `where exists (select 1 from activity_option_prices p where p.activity_option_id = o.id) ` +
      `on conflict (activity_option_id, starts_at) do nothing;`,
  );

  return lines.join('\n');
}
