#!/usr/bin/env node
// Moves every browser source map OUT of the deployable output and into a private directory, so the
// maps exist for debugging but are never served to the public.
//
// Why not just disable source maps: error_logs is the primary window into customer-visible failures,
// and a minified entry names nothing. On 2026-08-01 one homepage session logged `Error: fa`,
// `Error: Aa` and `undefined is not an object (evaluating 'a.J')` — four cascading failures that
// could not be traced to a file. Why not serve them: publishing .map files reconstructs the client
// source for anyone who asks.
//
// So: BUILD the maps, SHIP without them, KEEP them keyed by release SHA. scripts/symbolicate.mjs
// turns a stored stack back into file:line using the maps for the build that produced it.
//
// Ordering is load-bearing. This runs AFTER `pages:build` and BEFORE the artifact is uploaded and
// checksummed, so the manifest covers exactly what deploys — maps included in the checksum would
// make the "deployed bytes == verified bytes" guarantee describe files that never shipped.
//
// The .js files are left untouched, including their trailing `//# sourceMappingURL=` comment: the map
// simply 404s if someone opens devtools. That is deliberate — rewriting the tail of every bundle to
// strip a comment is a real corruption risk on the deploy path, and the comment leaks nothing the
// filename didn't already.
import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from './lib.mjs';

/** Every *.map under `dir`, recursively. */
export async function findSourceMaps(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found; // absent directory — the caller decides whether that is fatal
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findSourceMaps(full)));
    else if (entry.name.endsWith('.map')) found.push(full);
  }
  return found;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const from = args['artifact-dir'] ?? '.vercel/output/static';
  const to = args['maps-dir'] ?? 'sourcemaps-out';

  try {
    await stat(from);
  } catch {
    console.error(
      `✗ extract-source-maps: artifact dir "${from}" does not exist — run the build first`,
    );
    process.exit(1);
  }

  const maps = await findSourceMaps(from);
  if (maps.length === 0) {
    // Fail loudly rather than silently shipping a build with no maps to debug with: it means
    // productionBrowserSourceMaps got turned off, and every future client error goes unreadable.
    console.error(
      `✗ extract-source-maps: no .map files under "${from}". productionBrowserSourceMaps must be ` +
        `enabled in next.config.mjs, or client errors in error_logs stay minified.`,
    );
    process.exit(1);
  }

  let bytes = 0;
  for (const map of maps) {
    const dest = join(to, relative(from, map));
    await mkdir(dirname(dest), { recursive: true });
    bytes += (await stat(map)).size;
    await rename(map, dest);
  }

  // Proves the deployable tree is clean — the assertion that actually matters for disclosure.
  const left = await findSourceMaps(from);
  if (left.length > 0) {
    console.error(`✗ extract-source-maps: ${left.length} map(s) still under "${from}": ${left[0]}`);
    process.exit(1);
  }

  console.log(
    `✓ extracted ${maps.length} source map(s) (${(bytes / 1024 / 1024).toFixed(1)} MB) out of ` +
      `"${from}" into "${to}" — none will be served publicly`,
  );
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ extract-source-maps failed: ${err.message}`);
    process.exit(1);
  });
}
