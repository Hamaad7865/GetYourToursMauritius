import { describe, expect, it } from 'vitest';
import { evaluateGitIntegration } from '../../scripts/release/cloudflare-preflight.mjs';

describe('release/cloudflare-preflight evaluateGitIntegration', () => {
  it('passes when no git source is connected at all', () => {
    expect(evaluateGitIntegration({}).disabled).toBe(true);
  });

  it('passes when production is disabled and preview is none', () => {
    const project = {
      source: {
        config: { production_deployments_enabled: false, preview_deployment_setting: 'none' },
      },
    };
    expect(evaluateGitIntegration(project).disabled).toBe(true);
  });

  it('fails when production automatic deployments are still enabled', () => {
    const project = {
      source: {
        config: { production_deployments_enabled: true, preview_deployment_setting: 'none' },
      },
    };
    expect(evaluateGitIntegration(project).disabled).toBe(false);
  });

  it('fails when preview deployments are not set to none', () => {
    const project = {
      source: {
        config: { production_deployments_enabled: false, preview_deployment_setting: 'all' },
      },
    };
    expect(evaluateGitIntegration(project).disabled).toBe(false);
  });

  it('fails closed when the API response has an unrecognized shape', () => {
    const project = { source: { config: {} } };
    const result = evaluateGitIntegration(project);
    expect(result.disabled).toBe(false);
    expect(result.reason).toMatch(/fail closed/);
  });
});
