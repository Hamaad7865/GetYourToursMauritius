import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `release.yml` fires on `workflow_run` from the `CI` workflow. CI runs on `push` to main AND on
 * `pull_request`, and a `workflow_run` trigger with no `branches:` filter matches EVERY completion
 * of the named workflow — so every push to a feature branch with an open PR used to create its own
 * Release run, which `resolve-provenance` then correctly refused ("was not triggered by a push").
 * That put a red Release on the repo for roughly half of all runs, which is exactly the noise that
 * trains people to ignore red — and a red CI is what silently stops the Cloudflare deploy.
 *
 * The fix is to never START a Release run for a ref that has no provenance to resolve, NOT to soften
 * the gate inside `resolve-provenance`. This test pins both halves of that: the trigger is narrowed,
 * and the in-job assertions that actually enforce provenance are still there.
 *
 * This greps the YAML as text because a workflow has no executable form to assert against, so it is
 * kept to the few load-bearing lines rather than the shape of the whole file.
 */

const RELEASE_YML = readFileSync(
  join(process.cwd(), '.github', 'workflows', 'release.yml'),
  'utf8',
);

/**
 * The lines nested under the exact line `header`, up to the next line indented no deeper than
 * `header` itself. Blank lines and comments are dropped, so re-wrapping a comment can't break a test.
 */
function block(header: string): string[] {
  const lines = RELEASE_YML.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === header);
  expect(start, `release.yml has no line ${JSON.stringify(header)}`).toBeGreaterThan(-1);
  const baseIndent = header.length - header.trimStart().length;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (line.length - line.trimStart().length <= baseIndent) break;
    out.push(trimmed);
  }
  return out;
}

describe('release.yml — a Release run only ever starts for a successful push to main', () => {
  it('filters the workflow_run trigger to main, so a PR branch never creates a run at all', () => {
    const trigger = block('  workflow_run:');
    expect(trigger).toContain("workflows: ['CI']");
    // Load-bearing: `branches` on `workflow_run` matches the TRIGGERING run's head branch, so this
    // is what stops a `claude/*` PR build from spawning a Release run in the first place.
    expect(trigger).toContain('branches: [main]');
  });

  it('skips resolve-provenance unless CI was a successful push to main', () => {
    const job = block('  resolve-provenance:').join(' ').replace(/\s+/g, ' ');
    // `workflow_run` cannot filter on conclusion or triggering event in `on:`, so the remaining
    // cases — CI on main that failed or was cancelled — are gated here. A false `if` SKIPS the run
    // (grey) instead of failing it (red), and skips every downstream job with it.
    expect(job).toMatch(/if: .*github\.event_name == 'workflow_dispatch'/);
    expect(job).toContain("github.event.workflow_run.event == 'push'");
    expect(job).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(job).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it('still asserts provenance inside the job — the trigger filter is not the only gate', () => {
    // The `if` decides whether to INVOKE the gate; these decide whether the run may deploy. They
    // also cover the workflow_dispatch retry path, which no trigger filter can reach. Never relax
    // one of these to make a run go green.
    expect(RELEASE_YML).toContain('[ "$CONCLUSION" = "success" ]');
    expect(RELEASE_YML).toContain('[ "$TRIGGER_EVENT" = "push" ]');
    expect(RELEASE_YML).toContain('[ "$HEAD_BRANCH" = "main" ]');
    expect(RELEASE_YML).toContain('[ "$HEAD_REPO" = "$REPO" ]');
  });
});
