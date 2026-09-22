/**
 * Secrets Management
 *
 * From spec section 6: Infisical everywhere. No .env files.
 * Provides a unified interface for secret injection across contexts:
 * - Local development: Infisical CLI
 * - Pre-commit hooks: Infisical CLI
 * - CI: Infisical GitHub Action / environment variables
 * - Fallback: native CI secrets (GitHub Secrets, GitLab CI variables)
 *
 * devflow does not store or manage secrets directly — it wraps
 * Infisical CLI and provides fallback when Infisical is unavailable.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Check if Infisical CLI is installed and available.
 *
 * @returns {{ installed: boolean, version: string|null }}
 */
function checkInfisical() {
  try {
    const version = execSync('infisical --version', { stdio: 'pipe' }).toString().trim();
    return { installed: true, version };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * Check if running in a CI environment.
 *
 * @returns {boolean}
 */
function isCI() {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.BITBUCKET_BUILD_NUMBER
  );
}

/**
 * Get the secrets injection command for wrapping a command.
 * Returns the command prefix that injects secrets at runtime.
 *
 * @param {Object} [options]
 * @param {string} [options.environment="dev"] - Infisical environment
 * @param {string} [options.projectId] - Infisical project ID
 * @returns {{ command: string, source: string }}
 */
function getInjectionCommand(options = {}) {
  const env = options.environment || 'dev';

  // Check Infisical first
  const infisical = checkInfisical();
  if (infisical.installed) {
    let cmd = `infisical run --env=${env}`;
    if (options.projectId) {
      cmd += ` --projectId=${options.projectId}`;
    }
    return { command: cmd + ' --', source: 'infisical' };
  }

  // CI fallback — secrets come from CI environment
  if (isCI()) {
    return { command: '', source: 'ci-environment' };
  }

  // No Infisical, not CI — check for .env.example to warn
  return { command: '', source: 'none' };
}

/**
 * Generate Infisical configuration for CI workflows.
 *
 * @param {string} platform - CI platform ID
 * @param {Object} [options]
 * @returns {string} CI config snippet
 */
function generateCISecretConfig(platform, options = {}) {
  const env = options.environment || 'production';

  switch (platform) {
    case 'github-actions':
      return `      - name: Inject secrets
        uses: Infisical/secrets-action@v1
        with:
          environment: ${env}
          project-id: \${{ secrets.INFISICAL_PROJECT_ID }}
          client-id: \${{ secrets.INFISICAL_CLIENT_ID }}
          client-secret: \${{ secrets.INFISICAL_CLIENT_SECRET }}`;

    case 'gitlab-ci':
      return `  before_script:
    - infisical run --env=${env} -- env > .env.ci
    - source .env.ci`;

    case 'bitbucket-pipelines':
      return `      - pipe: Infisical/secrets-pipe:1.0.0
        variables:
          ENVIRONMENT: "${env}"`;

    default:
      return '# Infisical integration — configure manually for this platform';
  }
}

/**
 * Validate that a repository has no committed .env files.
 * Returns violations found.
 *
 * @param {string} repoRoot
 * @returns {string[]} List of .env files found in tracked files
 */
function checkForEnvFiles(repoRoot) {
  try {
    const tracked = execSync('git ls-files', { cwd: repoRoot, stdio: 'pipe' })
      .toString().trim().split('\n');
    return tracked.filter(f => {
      const base = path.basename(f);
      return base.startsWith('.env') && base !== '.env.example' && base !== '.env.template';
    });
  } catch {
    return [];
  }
}

/**
 * Generate .env.example from Infisical project (if available)
 * or from a provided list of required env vars.
 *
 * @param {string} repoRoot
 * @param {string[]} [requiredVars]
 */
function generateEnvExample(repoRoot, requiredVars = []) {
  const examplePath = path.join(repoRoot, '.env.example');
  const lines = [
    '# Required environment variables',
    '# Do NOT put actual values here — use Infisical for secrets management',
    '# See: https://infisical.com/docs/getting-started/introduction',
    '',
  ];

  for (const v of requiredVars) {
    lines.push(`${v}=`);
  }

  fs.writeFileSync(examplePath, lines.join('\n') + '\n');
}

module.exports = {
  checkInfisical,
  isCI,
  getInjectionCommand,
  generateCISecretConfig,
  checkForEnvFiles,
  generateEnvExample,
};
