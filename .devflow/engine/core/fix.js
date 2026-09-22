/**
 * devflow fix — Automatic Remediation
 *
 * From spec section 16.1: "devflow fix for automatic remediation"
 * and Phase 1 Week 4: "aggressive devflow fix expansion"
 *
 * The difference between showing what is wrong and fixing it is the
 * difference between a tool developers tolerate and one they trust.
 */

'use strict';

const { execSync } = require('child_process');

/**
 * @typedef {Object} FixResult
 * @property {boolean} fixed - Whether the issue was fixed
 * @property {string} tool - Tool that fixed it
 * @property {string} action - What was done
 * @property {string} [command] - Command that was run
 * @property {string} [error] - Error if fix failed
 */

/**
 * Known auto-fix strategies by tool/finding type.
 */
const FIX_STRATEGIES = {
  // Formatting fixes
  'ruff': {
    canFix: true,
    command: (scope) => `ruff check --fix ${scope || '.'}`,
    formatCommand: (scope) => `ruff format ${scope || '.'}`,
    description: 'Auto-fix Python lint issues and format',
  },
  'black': {
    canFix: true,
    command: (scope) => `black ${scope || '.'}`,
    description: 'Auto-format Python code',
  },
  'eslint': {
    canFix: true,
    command: (scope) => `eslint --fix ${scope || '.'}`,
    description: 'Auto-fix JavaScript/TypeScript lint issues',
  },
  'prettier': {
    canFix: true,
    command: (scope) => `prettier --write ${scope || '.'}`,
    description: 'Auto-format JavaScript/TypeScript code',
  },
  'rustfmt': {
    canFix: true,
    command: () => 'cargo fmt',
    description: 'Auto-format Rust code',
  },
  'golangci-lint': {
    canFix: true,
    command: (scope) => `golangci-lint run --fix ${scope || '.'}`,
    description: 'Auto-fix Go lint issues',
  },

  // Dependency fixes
  'trivy-cve': {
    canFix: false,
    suggest: (finding) => {
      if (finding.includes('requirements.txt')) {
        return `Update the vulnerable package: pip install --upgrade <package>`;
      }
      if (finding.includes('package')) {
        return `Update the vulnerable package: npm update <package>`;
      }
      return 'Update the vulnerable dependency to a patched version';
    },
    description: 'Suggest dependency update for CVE',
  },

  // Security — cannot auto-fix, provide guidance
  'trivy-secrets': {
    canFix: false,
    suggest: () => 'Remove the secret from source code. Use Infisical for secrets management.',
    description: 'Secrets must be removed manually',
  },
  'semgrep': {
    canFix: false,
    suggest: (finding) => `Review and fix the security finding: ${finding}`,
    description: 'Security findings require manual review',
  },
  'bandit': {
    canFix: false,
    suggest: (finding) => `Review and fix the security finding: ${finding}`,
    description: 'Security findings require manual review',
  },
};

/**
 * Attempt to auto-fix findings from a failed check.
 *
 * @param {string} repoRoot
 * @param {Object} options
 * @param {string} [options.tool] - Specific tool to fix for
 * @param {string} [options.scope] - Path scope
 * @returns {FixResult[]}
 */
function fix(repoRoot, options = {}) {
  const results = [];

  if (options.tool) {
    // Fix for a specific tool
    const result = fixForTool(repoRoot, options.tool, options.scope);
    results.push(result);
  } else {
    // Run all available auto-fixers
    for (const [tool, strategy] of Object.entries(FIX_STRATEGIES)) {
      if (strategy.canFix) {
        const result = fixForTool(repoRoot, tool, options.scope);
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * Fix issues for a specific tool.
 *
 * @param {string} repoRoot
 * @param {string} tool
 * @param {string} [scope]
 * @returns {FixResult}
 */
function fixForTool(repoRoot, tool, scope) {
  const strategy = FIX_STRATEGIES[tool];

  if (!strategy) {
    return { fixed: false, tool, action: 'No fix strategy available', error: `Unknown tool: ${tool}` };
  }

  if (!strategy.canFix) {
    const suggestion = strategy.suggest ? strategy.suggest('') : 'Manual fix required';
    return { fixed: false, tool, action: suggestion };
  }

  const command = strategy.command(scope);
  try {
    execSync(command, { cwd: repoRoot, stdio: 'pipe', timeout: 30000 });
    return { fixed: true, tool, action: strategy.description, command };
  } catch (err) {
    return {
      fixed: false,
      tool,
      action: strategy.description,
      command,
      error: (err.stderr || err.message || '').toString().slice(0, 200),
    };
  }
}

/**
 * Get fix suggestion for a finding.
 *
 * @param {string} tool
 * @param {string} finding
 * @returns {string}
 */
function getSuggestion(tool, finding) {
  const strategy = FIX_STRATEGIES[tool];
  if (!strategy) return 'No fix suggestion available';

  if (strategy.canFix) {
    return `Run 'devflow fix --tool ${tool}' to auto-fix`;
  }

  if (strategy.suggest) {
    return strategy.suggest(finding);
  }

  return 'Manual fix required';
}

/**
 * Check if a tool supports auto-fix.
 *
 * @param {string} tool
 * @returns {boolean}
 */
function canAutoFix(tool) {
  const strategy = FIX_STRATEGIES[tool];
  return strategy ? strategy.canFix : false;
}

module.exports = {
  fix,
  fixForTool,
  getSuggestion,
  canAutoFix,
  FIX_STRATEGIES,
};
