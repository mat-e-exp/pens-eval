/**
 * Tool Presence Checker
 *
 * Verifies which enforcement tools are installed locally.
 * Used by `devflow init` to warn about missing tools and by
 * `devflow check` to skip tools that aren't available.
 */

'use strict';

const { execSync } = require('child_process');

/**
 * Tool definitions — how to check if each tool is available.
 */
const TOOL_CHECKS = {
  trivy: { command: 'trivy --version', install: 'brew install trivy' },
  semgrep: { command: 'semgrep --version', install: 'pip install semgrep' },
  ruff: { command: 'ruff --version', install: 'pip install ruff' },
  black: { command: 'black --version', install: 'pip install black' },
  eslint: { command: 'eslint --version', install: 'npm install -g eslint' },
  prettier: { command: 'prettier --version', install: 'npm install -g prettier' },
  bandit: { command: 'bandit --version', install: 'pip install bandit' },
  gosec: { command: 'gosec --version', install: 'go install github.com/securego/gosec/v2/cmd/gosec@latest' },
  'golangci-lint': { command: 'golangci-lint --version', install: 'brew install golangci-lint' },
  clippy: { command: 'cargo clippy --version', install: 'rustup component add clippy' },
  rustfmt: { command: 'rustfmt --version', install: 'rustup component add rustfmt' },
  rubocop: { command: 'rubocop --version', install: 'gem install rubocop' },
  brakeman: { command: 'brakeman --version', install: 'gem install brakeman' },
  tflint: { command: 'tflint --version', install: 'brew install tflint' },
  tfsec: { command: 'tfsec --version', install: 'brew install tfsec' },
  checkstyle: { command: 'checkstyle --version', install: 'brew install checkstyle' },
  spotbugs: { command: 'spotbugs -version', install: 'brew install spotbugs' },
  infisical: { command: 'infisical --version', install: 'brew install infisical/get-cli/infisical' },
  'pip-audit': { command: 'pip-audit --version', install: 'pip install pip-audit' },
  'pip-licenses': { command: 'pip-licenses --version', install: 'pip install pip-licenses' },
  'go-licenses': { command: 'go-licenses version', install: 'go install github.com/google/go-licenses@latest' },
  'cargo-license': { command: 'cargo-license --version', install: 'cargo install cargo-license' },
  'license_finder': { command: 'license_finder version', install: 'gem install license_finder' },
};

/**
 * Check if a single tool is installed.
 *
 * @param {string} tool - Tool name
 * @returns {{ installed: boolean, version: string|null }}
 */
/**
 * Version commands are given a generous window: semgrep alone takes about six
 * seconds to start, and a false "not installed" sends a developer to install
 * something they already have.
 */
const VERSION_TIMEOUT_MS = 15000;

function checkTool(tool) {
  const check = TOOL_CHECKS[tool];
  if (!check) {
    return { installed: false, version: null };
  }

  try {
    const output = execSync(check.command, { stdio: 'pipe', timeout: VERSION_TIMEOUT_MS }).toString().trim();
    // Extract version from first line
    const version = output.split('\n')[0].trim();
    return { installed: true, version };
  } catch {
    // A version command can be slow enough to time out while the tool is
    // present — semgrep takes ~6s to start. Presence is what the caller
    // needs, so fall back to resolving the binary on PATH.
    return isOnPath(tool)
      ? { installed: true, version: null }
      : { installed: false, version: null };
  }
}

/**
 * Whether a binary resolves on PATH. Cheap, and unlike a version command it
 * cannot be slowed down by the tool's own startup cost.
 */
function isOnPath(tool) {
  const probe = process.platform === 'win32' ? `where ${tool}` : `command -v ${tool}`;
  try {
    execSync(probe, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check all tools required by an enforcement plan.
 *
 * @param {Object} plan - Enforcement plan
 * @returns {{ installed: string[], missing: Array<{tool: string, install: string}> }}
 */
function checkPlanTools(plan) {
  const toolSet = new Set();

  for (const hook of plan.preCommit.hooks) {
    if (hook.internal) continue; // runs inside devflow, not an external tool
    toolSet.add(hook.command);
  }
  for (const job of plan.ciOnPush.jobs) {
    if (job.command) toolSet.add(job.command);
  }

  // Tools that are always available or handled by CI (not local tools)
  const SKIP_TOOLS = new Set(['npm', 'npx', 'node', 'git', 'sonar-scanner', 'licence-check']);

  const installed = [];
  const missing = [];

  for (const tool of toolSet) {
    if (SKIP_TOOLS.has(tool)) {
      installed.push(tool);
      continue;
    }

    const result = checkTool(tool);
    if (result.installed) {
      installed.push(tool);
    } else {
      const check = TOOL_CHECKS[tool];
      if (check) {
        missing.push({ tool, install: check.install });
      }
      // Tools without a TOOL_CHECKS entry and not in SKIP_TOOLS
      // are CI-only tools — don't warn about them locally
    }
  }

  return { installed, missing };
}

module.exports = {
  checkTool,
  checkPlanTools,
  TOOL_CHECKS,
  isOnPath,
  VERSION_TIMEOUT_MS,
};
