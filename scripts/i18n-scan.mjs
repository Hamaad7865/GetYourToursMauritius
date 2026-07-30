import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

/** Every .ts/.tsx file under src/ and app/. */
export function sourceFiles() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/node_modules|\.next/.test(p)) walk(p);
      } else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'app'));
  return out;
}

/** Keys defined in the French table (top-level, two-space-indented properties). */
export function frenchKeys() {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/i18n/messages.ts'), 'utf8');
  const keys = new Set();
  const re = /^ {2}(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*)):/gm;
  for (const m of src.matchAll(re)) {
    keys.add((m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  return keys;
}

/** Literal keys passed to t(...), mapped to the files that use them. */
export function usedKeys() {
  const used = new Map();
  const re = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$]*)`)/g;
  for (const f of sourceFiles()) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    for (const m of fs.readFileSync(f, 'utf8').matchAll(re)) {
      const key = (m[1] ?? m[2] ?? m[3])
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n');
      if (!used.has(key)) used.set(key, new Set());
      used.get(key).add(rel);
    }
  }
  return used;
}

// Run directly for a progress report: `node scripts/i18n-scan.mjs`
// Compare resolved absolute paths: process.argv[1] is the raw string as typed on the command line
// (e.g. a relative "scripts/i18n-scan.mjs"), so comparing it to import.meta.url directly never
// matched and the report silently never ran.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fr = frenchKeys();
  const used = usedKeys();
  const missing = [...used.keys()].filter((k) => !fr.has(k));
  console.log(
    `French keys: ${fr.size}   t() keys in use: ${used.size}   missing: ${missing.length}`,
  );
  for (const k of missing) console.log(`  ${JSON.stringify(k)}  ← ${[...used.get(k)][0]}`);
}
