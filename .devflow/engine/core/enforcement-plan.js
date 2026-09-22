/**
 * Enforcement Plan — the canonical, platform-agnostic representation of what
 * devflow enforces on a repository. Built once by the orchestrator, consumed
 * by any platform adapter.
 *
 * Every CI adapter, pre-commit hook, and CLI command reads from this structure.
 * No adapter ever modifies it.
 */

'use strict';

const { rulePath } = require('./rule-files');

/**
 * Repo-relative path to devflow's custom Trivy secret rules.
 * `init`/`update`/`check` copy the shipped file into `.devflow/rules/`, so every
 * hook and CI job references a path that exists on a clean checkout (DEC-027).
 * An absolute package path would be machine-specific and break on CI runners.
 */
const TRIVY_SECRET_CONFIG = rulePath('trivy-secret.yaml');

/**
 * @typedef {Object} StackEntry
 * @property {string} language - Language identifier (python, typescript, go, java, rust, ruby, terraform)
 * @property {string} path - Scoped path within repo (e.g. "backend/", "frontend/", ".")
 * @property {Object} tools
 * @property {string} tools.lint - Lint/format tool (e.g. "ruff", "eslint")
 * @property {string} tools.security - Security scanner (e.g. "bandit", "eslint-plugin-security")
 * @property {string} [tools.format] - Formatter if separate from linter (e.g. "black", "prettier")
 * @property {string} tools.scope - File glob pattern (e.g. "**\/*.py")
 */

/**
 * @typedef {Object} PreCommitHook
 * @property {string} id - Unique hook identifier
 * @property {string} tool - Tool name (e.g. "trivy", "ruff", "eslint")
 * @property {string} command - Executable command
 * @property {string[]} args - Command arguments
 * @property {string} scope - File glob this hook applies to
 * @property {string} failPolicy - "closed" | "open" | "open-notify"
 */

/**
 * @typedef {Object} CIJob
 * @property {string} id - Unique job identifier
 * @property {string} name - Human-readable name
 * @property {string} tool - Tool name
 * @property {string} command - Executable command
 * @property {string[]} args - Command arguments
 * @property {string} scope - Path scope (e.g. "backend/**")
 * @property {string} failPolicy - "closed" | "open" | "open-notify"
 * @property {string} severity - Minimum severity this job catches
 * @property {string} [language] - Associated language if scoped to a stack
 */

/**
 * @typedef {Object} PRCheck
 * @property {string} id - Unique check identifier
 * @property {string} name - Human-readable name
 * @property {string} type - Check type: "loc_limit" | "required_fields" | "linked_issue" | "branch_age"
 * @property {Object} config - Type-specific configuration
 */

/**
 * @typedef {Object} NotificationConfig
 * @property {Object} [discord]
 * @property {string} discord.webhookEnvVar - Env var name holding webhook URL
 * @property {string} discord.minSeverity - Minimum severity to post ("high" | "critical")
 * @property {Object} [email]
 * @property {string[]} email.recipients - Email addresses
 * @property {string[]} email.events - Event types that trigger email
 * @property {boolean} prComment - Whether to post findings as PR comments
 */

/**
 * @typedef {Object} EnforcementPlan
 * @property {StackEntry[]} stacks - Detected language stacks with path scoping
 * @property {Object} preCommit - Layer 2: local pre-commit enforcement
 * @property {PreCommitHook[]} preCommit.hooks - Hooks to run
 * @property {number} preCommit.maxDurationMs - Time budget in ms (default 15000)
 * @property {Object} ciOnPush - Layer 3: CI enforcement on push
 * @property {CIJob[]} ciOnPush.jobs - CI jobs to run
 * @property {Object} prGate - Layer 4: PR gate checks
 * @property {PRCheck[]} prGate.checks - PR-level checks
 * @property {Object} mergeGate - Layer 5: merge requirements
 * @property {string[]} mergeGate.requiredChecks - Job/check IDs that must pass
 * @property {boolean} mergeGate.requireAllGreen - Whether all checks must pass
 * @property {Object} audit - Layer 6: audit logging config
 * @property {number[]} audit.tiers - Active tiers (1, 2, 3)
 * @property {string} audit.logPath - Path to in-repo audit log
 * @property {NotificationConfig} notifications - Notification routing config
 * @property {Object.<string, string>} failPolicy - Per-tool fail policy map
 * @property {string} platform - Target CI platform ID
 */

const VALID_LANGUAGES = ['python', 'typescript', 'javascript', 'go', 'java', 'rust', 'ruby', 'terraform'];
const VALID_FAIL_POLICIES = ['closed', 'open', 'open-notify'];
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'];
const VALID_PR_CHECK_TYPES = ['loc_limit', 'required_fields', 'linked_issue', 'branch_age', 'branch_naming'];
const VALID_PLATFORMS = ['github-actions', 'gitlab-ci', 'bitbucket-pipelines'];

/**
 * Default fail policy per tool — from spec section 17.
 */
const DEFAULT_FAIL_POLICY = {
  'trivy-secrets': 'closed',
  'trivy-cve': 'open-notify',
  'semgrep': 'open-notify',
  'codeql': 'open-notify',
  'coverage': 'closed',
  'infisical-local': 'closed',
  'infisical-ci': 'open-notify',
  'lint': 'open',
  'format': 'open',
  'licence': 'open-notify',
  'suppression': 'closed',
  'dangerous-config': 'closed',
  'lockfile': 'closed',
};

/**
 * Default PR gate checks — from spec sections 2.2 and 19.
 */
const DEFAULT_PR_CHECKS = [
  { id: 'loc-limit', name: 'PR size limit', type: 'loc_limit', config: { max: 400, hotfixMax: 600 } },
  { id: 'branch-naming', name: 'Branch naming convention', type: 'branch_naming', config: { prefixes: ['feature/', 'hotfix/', 'deps/', 'experiment/'] } },
  { id: 'branch-age', name: 'Branch age limit', type: 'branch_age', config: { feature: 48, hotfix: 4, experiment: 168 } },
];

/**
 * Build an enforcement plan from config and detected stacks.
 *
 * @param {Object} options
 * @param {StackEntry[]} options.stacks - Detected stacks
 * @param {string} options.platform - Target platform ID
 * @param {Object} [options.configOverrides] - Per-repo .devflow/config.yml overrides
 * @returns {EnforcementPlan}
 */
function buildPlan({ stacks, platform, configOverrides = {} }) {
  validateStacks(stacks);
  validatePlatform(platform);

  const failPolicy = { ...DEFAULT_FAIL_POLICY, ...configOverrides.failPolicy };
  const preCommitHooks = buildPreCommitHooks(stacks, failPolicy);
  const ciJobs = buildCIJobs(stacks, failPolicy);
  const prChecks = buildPRChecks(configOverrides);
  const requiredChecks = computeRequiredChecks(ciJobs);

  return {
    stacks,
    preCommit: {
      hooks: preCommitHooks,
      maxDurationMs: configOverrides.preCommitMaxDuration || 15000,
    },
    ciOnPush: {
      jobs: ciJobs,
    },
    prGate: {
      checks: prChecks,
    },
    mergeGate: {
      requiredChecks,
      requireAllGreen: configOverrides.requireAllGreen !== false,
    },
    audit: {
      tiers: configOverrides.auditTiers || [1, 2],
      logPath: configOverrides.auditLogPath || '.devflow/audit.log',
    },
    notifications: buildNotifications(configOverrides),
    failPolicy,
    platform,
  };
}

/**
 * Language-to-tool mapping — from spec section 2.5.
 */
const LANGUAGE_TOOLS = {
  python: {
    lint: 'ruff', format: 'black', security: 'bandit', scope: '**/*.py',
    lintArgs: (path) => ['check', '--exclude', '.devflow,.github', path || '.'],
    formatArgs: (path) => ['--check', '--extend-exclude', '.devflow,.github', path || '.'],
  },
  typescript: {
    lint: 'eslint', format: 'prettier', security: 'eslint', securityArgs: ['--no-error-on-unmatched-pattern'], scope: '**/*.ts',
    lintArgs: (path) => ['--ignore-pattern', '.devflow/', '--ignore-pattern', '.github/', path || '.'],
    formatArgs: (path) => ['--check', '--ignore-unknown', '--no-error-on-unmatched-pattern', path || '.'],
  },
  javascript: {
    lint: 'eslint', format: 'prettier', security: 'eslint', securityArgs: ['--no-error-on-unmatched-pattern'], scope: '**/*.js',
    lintArgs: (path) => ['--ignore-pattern', '.devflow/', '--ignore-pattern', '.github/', path || '.'],
    formatArgs: (path) => ['--check', '--ignore-unknown', '--no-error-on-unmatched-pattern', path || '.'],
  },
  go: {
    lint: 'golangci-lint', security: 'gosec', scope: '**/*.go',
    lintArgs: (path) => ['run', path ? `./${path}...` : './...'],
  },
  java: {
    lint: 'checkstyle', security: 'spotbugs', scope: '**/*.java',
    lintArgs: (path) => [path || '.'],
  },
  rust: {
    lint: 'clippy', format: 'rustfmt', security: 'cargo-audit', scope: '**/*.rs',
    lintArgs: () => ['--', '-D', 'warnings'],
    formatArgs: () => ['--check'],
  },
  ruby: {
    lint: 'rubocop', security: 'brakeman', scope: '**/*.rb',
    lintArgs: (path) => [path || '.'],
  },
  terraform: {
    lint: 'tflint', security: 'tfsec', scope: '**/*.tf',
    lintArgs: (path) => [path || '.'],
  },
};

/**
 * Checks that must pass before a merge: every CI job that fails closed.
 *
 * Read from each job's own `failPolicy` rather than looked up by tool name.
 * A job whose tool has no entry in the policy map is advisory, not required —
 * treating absence as "required" put an advisory ESLint scan in front of a
 * merge while leaving real gates out of it.
 *
 * Must be recomputed after modules extend the plan: the suppression,
 * dangerous-config and lockfile gates are contributed by modules and would
 * otherwise never appear here, so branch protection would be configured to
 * require everything except the gates that matter (DEC-032).
 *
 * @param {CIJob[]} ciJobs
 * @returns {string[]}
 */
function computeRequiredChecks(ciJobs) {
  return (ciJobs || []).filter(job => job.failPolicy === 'closed').map(job => job.id);
}

function buildPreCommitHooks(stacks, failPolicy) {
  const hooks = [];

  // Trivy secrets scan — always present, always fail closed
  // Pre-commit scans staged files only, not the whole directory
  // Uses custom secret rules to catch webhook URLs and other patterns Trivy misses
  hooks.push({
    id: 'trivy-secrets',
    tool: 'trivy-secrets',
    command: 'trivy',
    args: ['fs', '--scanners', 'secret', '--secret-config', TRIVY_SECRET_CONFIG, '--skip-dirs', "'**/.devflow/engine'", '--skip-files', "'**/trivy-secret.yaml'", '--skip-files', "'**/dangerous-config.yaml'", '--exit-code', '1', '.'],
    scope: '**/*',
    failPolicy: failPolicy['trivy-secrets'] || 'closed',
    stagedOnly: true,
  });

  // Per-stack lint + format hooks
  for (const stack of stacks) {
    const tools = LANGUAGE_TOOLS[stack.language];
    if (!tools) continue;

    const scopePrefix = stack.path === '.' ? '' : stack.path;
    const fullScope = scopePrefix ? `${scopePrefix}${tools.scope}` : tools.scope;

    const hookSuffix = scopePrefix ? '-' + scopePrefix.replace(/\/$/, '') : '';
    hooks.push({
      id: `lint-${stack.language}${hookSuffix}`,
      tool: 'lint',
      command: tools.lint,
      args: tools.lintArgs ? tools.lintArgs(scopePrefix) : [scopePrefix || '.'],
      scope: fullScope,
      failPolicy: failPolicy.lint || 'open',
    });

    if (tools.format) {
      const formatHook = {
        id: `format-${stack.language}${hookSuffix}`,
        tool: 'format',
        command: tools.format,
        args: tools.formatArgs ? tools.formatArgs(scopePrefix) : ['--check', scopePrefix || '.'],
        scope: fullScope,
        failPolicy: failPolicy.format || 'open',
      };

      // ruff, black and eslint all take an exclude flag; prettier does not,
      // so it is given the file list instead. Without this it reports every
      // file of the vendored engine on every commit (DEC-031).
      if (tools.format === 'prettier') {
        formatHook.scanTarget = 'staged-paths';
        formatHook.ignorePaths = ['.devflow', '.github'];
      }

      hooks.push(formatHook);
    }
  }

  return hooks;
}

function buildCIJobs(stacks, failPolicy) {
  const jobs = [];

  // Trivy secrets — always present
  // Uses custom secret rules to catch webhook URLs and other patterns Trivy misses
  jobs.push({
    id: 'trivy-secrets',
    name: 'Secrets scan',
    tool: 'trivy-secrets',
    command: 'trivy',
    args: ['fs', '--scanners', 'secret', '--secret-config', TRIVY_SECRET_CONFIG, '--skip-dirs', "'**/.devflow/engine'", '--skip-files', "'**/trivy-secret.yaml'", '--skip-files', "'**/dangerous-config.yaml'", '--exit-code', '1', '.'],
    scope: '**/*',
    failPolicy: failPolicy['trivy-secrets'] || 'closed',
    severity: 'critical',
  });

  // Trivy CVE — always present
  jobs.push({
    id: 'trivy-cve',
    name: 'CVE scan',
    tool: 'trivy-cve',
    command: 'trivy',
    args: ['fs', '--scanners', 'vuln', '--severity', 'CRITICAL,HIGH', '--exit-code', '1', '.'],
    scope: '**/*',
    failPolicy: failPolicy['trivy-cve'] || 'open-notify',
    severity: 'high',
  });

  // Semgrep — always present
  jobs.push({
    id: 'semgrep',
    name: 'Semgrep security scan',
    tool: 'semgrep',
    command: 'semgrep',
    args: ['scan', '--config', 'auto', '--error'],
    scope: '**/*',
    failPolicy: failPolicy.semgrep || 'open-notify',
    severity: 'high',
  });

  // CodeQL — GitHub-managed action, not a CLI tool
  jobs.push({
    id: 'codeql',
    name: 'CodeQL SAST',
    tool: 'codeql',
    command: null, // Handled by github/codeql-action, not a CLI command
    args: [],
    scope: '**/*',
    failPolicy: failPolicy.codeql || 'open-notify',
    severity: 'high',
    isGitHubAction: true,
  });

  // Per-stack security scanners
  for (const stack of stacks) {
    const tools = LANGUAGE_TOOLS[stack.language];
    if (!tools) continue;

    const scopePrefix = stack.path === '.' ? '' : stack.path;
    const fullScope = scopePrefix ? `${scopePrefix}${tools.scope}` : tools.scope;

    const securityId = `security-${stack.language}${scopePrefix ? '-' + scopePrefix.replace(/\/$/, '') : ''}`;
    jobs.push({
      id: securityId,
      name: `${stack.language} security scan`,
      tool: tools.security,
      command: tools.security,
      args: tools.securityArgs ? [...tools.securityArgs, scopePrefix || '.'] : [scopePrefix || '.'],
      scope: fullScope,
      failPolicy: failPolicy[tools.security] || 'open-notify',
      severity: 'high',
      language: stack.language,
    });

    const lintId = `lint-${stack.language}${scopePrefix ? '-' + scopePrefix.replace(/\/$/, '') : ''}`;
    jobs.push({
      id: lintId,
      name: `${stack.language} lint`,
      tool: 'lint',
      command: tools.lint,
      args: [scopePrefix || '.'],
      scope: fullScope,
      failPolicy: failPolicy.lint || 'open',
      severity: 'low',
      language: stack.language,
    });
  }

  // Licence compliance handled by licence-compliance module — not in base plan

  return jobs;
}

function buildPRChecks(configOverrides) {
  const checks = [...DEFAULT_PR_CHECKS];

  if (configOverrides.prChecks) {
    for (const override of configOverrides.prChecks) {
      const idx = checks.findIndex(c => c.id === override.id);
      if (idx !== -1) {
        checks[idx] = { ...checks[idx], ...override };
      } else {
        checks.push(override);
      }
    }
  }

  return checks;
}

function buildNotifications(configOverrides) {
  return {
    discord: configOverrides.discord || null,
    email: configOverrides.email || null,
    prComment: configOverrides.prComment !== false,
  };
}

function validateStacks(stacks) {
  if (!Array.isArray(stacks) || stacks.length === 0) {
    throw new Error('Enforcement plan requires at least one stack');
  }
  for (const stack of stacks) {
    if (!VALID_LANGUAGES.includes(stack.language)) {
      throw new Error(`Unknown language: ${stack.language}. Valid: ${VALID_LANGUAGES.join(', ')}`);
    }
    if (!stack.path || typeof stack.path !== 'string') {
      throw new Error(`Stack ${stack.language} missing path`);
    }
  }
}

function validatePlatform(platform) {
  if (!VALID_PLATFORMS.includes(platform)) {
    throw new Error(`Unknown platform: ${platform}. Valid: ${VALID_PLATFORMS.join(', ')}`);
  }
}

module.exports = {
  computeRequiredChecks,
  buildPlan,
  LANGUAGE_TOOLS,
  DEFAULT_FAIL_POLICY,
  DEFAULT_PR_CHECKS,
  VALID_LANGUAGES,
  VALID_FAIL_POLICIES,
  VALID_SEVERITIES,
  VALID_PR_CHECK_TYPES,
  VALID_PLATFORMS,
};
