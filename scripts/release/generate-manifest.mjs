#!/usr/bin/env node
// Packages the built Cloudflare edge bundle (.vercel/output/static) into a single immutable
// tarball + a manifest describing exactly what's in it. Runs ONCE, in the `release-artifact` job of
// CI, only on a push to main, only after typecheck/lint/format/coverage/build/pages:build all
// passed. Everything downstream (release.yml) deploys this exact tarball — it is never rebuilt.
//
// Usage:
//   node scripts/release/generate-manifest.mjs \
//     --sha <git-sha> --run-id <github-run-id> \
//     --artifact-dir .vercel/output/static \
//     --package-lock package-lock.json \
//     --out-tarball release.tar.gz --out-manifest manifest.json
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, writeFileSync, statSync } from 'node:fs';
import { parseArgs, isPlausibleGitSha } from './lib.mjs';

async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sha = args.sha;
  const runId = args['run-id'];
  const artifactDir = args['artifact-dir'] ?? '.vercel/output/static';
  const packageLockPath = args['package-lock'] ?? 'package-lock.json';
  const outTarball = args['out-tarball'] ?? 'release.tar.gz';
  const outManifest = args['out-manifest'] ?? 'manifest.json';

  if (!isPlausibleGitSha(sha)) throw new Error(`--sha is not a plausible git SHA: ${sha}`);
  if (!runId) throw new Error('--run-id is required');
  if (!existsSync(artifactDir) || !statSync(artifactDir).isDirectory()) {
    throw new Error(`Artifact directory not found (did pages:build run first?): ${artifactDir}`);
  }
  if (!existsSync(packageLockPath)) throw new Error(`Not found: ${packageLockPath}`);

  // Deterministic tarball: sort entries, strip owner/mtime so the same input always hashes the
  // same way (a checksum that changes on every run because of timestamps is worthless).
  execFileSync(
    'tar',
    [
      '--sort=name',
      '--mtime=UTC 2020-01-01',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '-czf',
      outTarball,
      '-C',
      artifactDir,
      '.',
    ],
    { stdio: 'inherit' },
  );

  const artifactSha256 = await sha256File(outTarball);
  const packageLockSha256 = await sha256File(packageLockPath);
  const nodeVersion = process.version;
  // Windows resolves the real binary as npm.cmd; Node's own docs recommend shell:true for spawning
  // a .cmd/.bat file (spawning it directly throws EINVAL on this Node version). Safe here: the args
  // are a fixed internal literal, never interpolated user input. No-op on Linux (CI itself).
  const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8', shell: true }).trim();

  const manifest = {
    schemaVersion: 1,
    gitSha: sha,
    githubRunId: String(runId),
    buildTimestamp: new Date().toISOString(),
    nodeVersion,
    npmVersion,
    packageLockSha256,
    artifactSha256,
    artifactFile: outTarball,
  };
  writeFileSync(outManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✓ wrote ${outManifest} and ${outTarball}`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(`✗ generate-manifest failed: ${err.message}`);
  process.exit(1);
});
