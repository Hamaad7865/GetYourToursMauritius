/**
 * Committed placeholder. Overwritten by scripts/release/write-release-metadata.mjs in the CI
 * `verify` job, BEFORE `npm run build`, on every push-to-main run — so the exact git SHA and
 * GitHub Actions run id get compiled directly into the built bundle as literal constants.
 *
 * This is deliberately NOT a runtime env var (`process.env.RELEASE_SHA` read by a Cloudflare Pages
 * Function): Pages env vars are configured per-PROJECT in the dashboard, not per-deploy, and
 * `wrangler pages deploy` has no flag to inject one ad hoc for a single deployment. Trying to work
 * around that by rewriting the Pages project's env vars via the API before every deploy risks
 * clobbering the OTHER vars/secrets already configured there (SUPABASE_SERVICE_ROLE_KEY, PEACH_*,
 * etc — see docs/handbook/deployment.md) if the API's PATCH semantics turn out not to be a safe
 * merge. Baking the SHA into the artifact at build time has no such risk and is stronger anyway:
 * it becomes part of the exact bytes the manifest checksums, not a separate mutable side channel.
 *
 * Never edit this file by hand outside of local experimentation — commit it with these null
 * defaults so a fresh checkout still typechecks/builds/tests without CI having touched it.
 */
export const RELEASE_SHA: string | null = null;
export const RELEASE_RUN_ID: string | null = null;
export const RELEASE_BUILD_TIMESTAMP: string | null = null;
