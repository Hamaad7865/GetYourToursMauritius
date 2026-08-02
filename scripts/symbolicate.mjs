#!/usr/bin/env node
// Turns a minified stack from `error_logs` back into real file names and line numbers, using the
// source maps kept privately for the build that produced it (see scripts/release/extract-source-maps).
//
//   1. get the stack:      select stack, route, created_at from error_logs order by created_at desc;
//   2. get the build:      curl -s https://bellemaretours.com/api/v1/health   → releaseSha
//   3. download that release's `sourcemaps` artifact from the CI run into ./sourcemaps-out
//   4. node scripts/symbolicate.mjs --stack-file stack.txt [--maps-dir sourcemaps-out]
//
// Zero dependencies: node:module's SourceMap does the lookup, so this needs no npm install and
// cannot drift from the build toolchain.
//
// Pass --stack-file (a file holding the stack verbatim) rather than pasting a stack as an argument:
// stacks contain characters most shells mangle, and PowerShell in particular rewrites them.
import { readFile } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import { basename, join } from 'node:path';
import { parseArgs } from './release/lib.mjs';

/**
 * Both stack dialects seen in error_logs:
 *   V8/Chrome:  "    at ix (https://host/_next/static/chunks/4bd1.js:1:122950)"
 *   Safari:     "ix@https://host/_next/static/chunks/4bd1.js:1:122950"
 * Returns { fn, file, line, column } per frame; unparseable lines are passed through untouched.
 */
export function parseStack(stack) {
  const frames = [];
  for (const raw of stack.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const v8 = line.match(/^at\s+(?:(.+?)\s+\()?(\S+?):(\d+):(\d+)\)?$/);
    const safari = line.match(/^(.*?)@(\S+?):(\d+):(\d+)$/);
    const m = v8 ?? safari;
    if (!m) {
      frames.push({ raw: line });
      continue;
    }
    frames.push({
      raw: line,
      fn: (m[1] || '').trim() || '<anonymous>',
      file: m[2],
      line: Number(m[3]),
      column: Number(m[4]),
    });
  }
  return frames;
}

/** Map a frame through its .map, if one is present for that chunk. */
async function resolveFrame(frame, mapsDir, cache) {
  if (!frame.file) return null;
  const name = basename(frame.file.split('?')[0]);
  if (!name.endsWith('.js')) return null;

  if (!cache.has(name)) {
    // Chunks live under chunks/ but the layout can vary; try the flat name and the chunks/ path.
    const candidates = [join(mapsDir, 'chunks', `${name}.map`), join(mapsDir, `${name}.map`)];
    let loaded = null;
    for (const path of candidates) {
      try {
        loaded = new SourceMap(JSON.parse(await readFile(path, 'utf8')));
        break;
      } catch {
        /* try the next candidate */
      }
    }
    cache.set(name, loaded);
  }
  const map = cache.get(name);
  if (!map) return null;

  // SourceMap.findEntry takes ZERO-based line/column; stack traces are one-based on the line.
  const entry = map.findEntry(frame.line - 1, frame.column);
  if (!entry || entry.originalSource === undefined) return null;
  return {
    source: entry.originalSource,
    line: entry.originalLine + 1,
    column: entry.originalColumn,
    name: entry.name,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mapsDir = args['maps-dir'] ?? 'sourcemaps-out';
  const stackFile = args['stack-file'];
  if (!stackFile) {
    console.error(
      'usage: node scripts/symbolicate.mjs --stack-file <file> [--maps-dir sourcemaps-out]\n' +
        '  --stack-file  a file containing the `stack` column from an error_logs row, verbatim',
    );
    process.exit(1);
  }

  const frames = parseStack(await readFile(stackFile, 'utf8'));
  const cache = new Map();
  let resolved = 0;

  for (const frame of frames) {
    const hit = await resolveFrame(frame, mapsDir, cache);
    if (hit) {
      resolved += 1;
      const fn = hit.name || frame.fn;
      console.log(`  ${fn} — ${hit.source}:${hit.line}:${hit.column}`);
    } else {
      console.log(`  ${frame.raw}${frame.file ? '   (no map)' : ''}`);
    }
  }

  if (resolved === 0) {
    console.error(
      `\n✗ nothing resolved. The maps in "${mapsDir}" are probably from a DIFFERENT build than the ` +
        `one that threw — match error_logs.created_at to the release, and download that run's ` +
        `"sourcemaps" artifact. A chunk filename hash differs on every build.`,
    );
    process.exit(1);
  }
  console.log(`\n✓ resolved ${resolved}/${frames.length} frame(s)`);
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ symbolicate failed: ${err.message}`);
    process.exit(1);
  });
}
