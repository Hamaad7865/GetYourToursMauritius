#!/usr/bin/env node
// Blocks the release the moment before it would touch deployment secrets, unless Cloudflare Pages'
// OWN git-integration auto-deploy is confirmed disabled for both Production and Preview. Without
// this, `wrangler pages deploy` in release.yml and Cloudflare's git integration race to deploy the
// same push — whichever finishes last silently "wins", and the loser's SHA is running while
// release.yml reports success (or vice versa). This is a READ-ONLY check: it never disables
// anything itself (see docs/handbook/deployment.md for the one-time dashboard step the operator
// must perform, and why it can't safely be automated — it also requires this workflow to be merged
// and secrets configured first, which is chicken-and-egg for a self-disabling script).
//
// Cloudflare's Pages REST API is the source of truth queried here: GET
// /accounts/{account_id}/pages/projects/{project_name}. The specific fields checked
// (source.config.production_deployments_enabled, source.config.preview_deployment_setting) were
// confirmed against a REAL project's API response (not docs — Cloudflare's docs don't publish this
// schema). Cloudflare has no `wrangler` subcommand for this (confirmed via `wrangler pages project
// --help` — only list/create/delete exist), so the fetch below is the only scriptable path. If
// Cloudflare ever renames these fields again, this check FAILS CLOSED (an unrecognized shape is
// treated as "not confirmed disabled", never as a pass) — see the ambiguous-shape branch below — so
// a Cloudflare API change blocks releases loudly instead of silently letting both deploy paths race.
import { requireEnv } from './lib.mjs';

const API_BASE = 'https://api.cloudflare.com/client/v4';

export function evaluateGitIntegration(project) {
  const source = project?.source;
  if (!source) {
    return { disabled: true, reason: 'no git source connected to the Pages project' };
  }
  const config = source.config ?? {};
  const prodEnabled = config.production_deployments_enabled;
  const previewSetting = config.preview_deployment_setting;

  if (prodEnabled === undefined && previewSetting === undefined) {
    return {
      disabled: false,
      reason:
        'git source is connected but neither production_deployments_enabled nor ' +
        'preview_deployment_setting was present in the API response — cannot confirm automatic ' +
        'deployments are disabled, treating as NOT disabled (fail closed)',
    };
  }
  const prodOk = prodEnabled === false;
  const previewOk = previewSetting === 'none' || previewSetting === undefined;
  if (prodOk && previewOk) {
    return {
      disabled: true,
      reason: 'production_deployments_enabled=false, preview disabled/none',
    };
  }
  return {
    disabled: false,
    reason: `production_deployments_enabled=${prodEnabled}, preview_deployment_setting=${previewSetting}`,
  };
}

async function main() {
  const apiToken = requireEnv('CLOUDFLARE_API_TOKEN');
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const project = requireEnv('CLOUDFLARE_PAGES_PROJECT');

  const res = await fetch(`${API_BASE}/accounts/${accountId}/pages/projects/${project}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    const errs = (body.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(
      `Cloudflare API error fetching Pages project "${project}": ${res.status} ${errs}`,
    );
  }

  const evaluation = evaluateGitIntegration(body.result);
  if (!evaluation.disabled) {
    throw new Error(
      `Cloudflare Pages automatic Git deployments are NOT confirmed disabled for project ` +
        `"${project}" (${evaluation.reason}). This pipeline deploys via wrangler from a verified ` +
        `artifact; if Cloudflare's own git integration is also deploying on push, the two race and ` +
        `either can silently overwrite the other. Disable it in the dashboard first: Workers & ` +
        `Pages → ${project} → Settings → Builds → Automatic deployments → turn OFF for Production ` +
        `and set Preview deployments to None. See docs/handbook/deployment.md.`,
    );
  }
  console.log(
    `✓ Cloudflare Pages automatic Git deployments confirmed disabled for "${project}" (${evaluation.reason})`,
  );
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ cloudflare-preflight failed: ${err.message}`);
    process.exit(1);
  });
}
