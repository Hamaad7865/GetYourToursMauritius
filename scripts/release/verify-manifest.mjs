#!/usr/bin/env node
// Verifies a downloaded release artifact + manifest before release.yml touches any secret.
// Fails closed: any mismatch, missing file, or malformed manifest is a non-zero exit, no fallback.
//
// Usage:
//   node scripts/release/verify-manifest.mjs \
//     --manifest manifest.json --tarball release.tar.gz --expected-sha <ci-head-sha>
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
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

/** Pure validator, unit-testable without touching the filesystem. */
export function validateManifestShape(manifest) {
  const errors = [];
  const required = [
    'schemaVersion',
    'gitSha',
    'githubRunId',
    'buildTimestamp',
    'nodeVersion',
    'npmVersion',
    'packageLockSha256',
    'artifactSha256',
  ];
  for (const key of required) {
    if (
      !manifest ||
      manifest[key] === undefined ||
      manifest[key] === null ||
      manifest[key] === ''
    ) {
      errors.push(`manifest missing field: ${key}`);
    }
  }
  if (manifest?.gitSha && !isPlausibleGitSha(manifest.gitSha)) {
    errors.push(`manifest.gitSha is not a plausible git SHA: ${manifest.gitSha}`);
  }
  if (manifest?.artifactSha256 && !/^[0-9a-f]{64}$/i.test(manifest.artifactSha256)) {
    errors.push('manifest.artifactSha256 is not a 64-char hex sha256');
  }
  if (manifest?.packageLockSha256 && !/^[0-9a-f]{64}$/i.test(manifest.packageLockSha256)) {
    errors.push('manifest.packageLockSha256 is not a 64-char hex sha256');
  }
  return errors;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest ?? 'manifest.json';
  const tarballPath = args.tarball ?? 'release.tar.gz';
  const expectedSha = args['expected-sha'];

  if (!isPlausibleGitSha(expectedSha)) {
    throw new Error(`--expected-sha is not a plausible git SHA: ${expectedSha}`);
  }
  if (!existsSync(manifestPath)) throw new Error(`Artifact manifest missing: ${manifestPath}`);
  if (!existsSync(tarballPath)) throw new Error(`Artifact tarball missing: ${tarballPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const shapeErrors = validateManifestShape(manifest);
  if (shapeErrors.length > 0) {
    throw new Error(`Malformed manifest:\n  - ${shapeErrors.join('\n  - ')}`);
  }

  if (manifest.gitSha !== expectedSha) {
    throw new Error(
      `Artifact SHA mismatch: manifest says ${manifest.gitSha}, CI head SHA is ${expectedSha}. ` +
        `Refusing to deploy an artifact built from a different commit than the one that triggered this release.`,
    );
  }

  const actualSha256 = await sha256File(tarballPath);
  if (actualSha256 !== manifest.artifactSha256) {
    throw new Error(
      `Artifact checksum mismatch: tarball hashes to ${actualSha256}, manifest says ${manifest.artifactSha256}. ` +
        `The artifact may be corrupted or tampered with — refusing to deploy.`,
    );
  }

  console.log(
    `✓ manifest verified: gitSha=${manifest.gitSha} artifactSha256=${actualSha256.slice(0, 12)}…`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ verify-manifest failed: ${err.message}`);
    process.exit(1);
  });
}
