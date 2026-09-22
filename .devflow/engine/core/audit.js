/**
 * Audit Logger
 *
 * From spec section 9: Every event produces a structured, attributed,
 * tamper-evident log entry. Append-only. Three tiers.
 *
 * Tier 1: GitHub Actions logs (90 days) — handled by CI workflows
 * Tier 2: .devflow/audit.log in repo (permanent) — handled here
 * Tier 3: Grafana Cloud (Phase 4) — future
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_LOG_PATH = '.devflow/audit.log';

/**
 * @typedef {Object} AuditEntry
 * @property {string} timestamp - ISO timestamp
 * @property {string} repo - Repository identifier
 * @property {string} developer - Developer identity
 * @property {string} event - Event type (pre-commit, ci-push, override, etc.)
 * @property {string} tool - Tool that produced the finding
 * @property {string} result - "passed" | "failed" | "warning" | "override"
 * @property {string} [severity] - Finding severity
 * @property {string} [finding] - Description of finding
 * @property {string} [branch] - Git branch
 * @property {string} [commit] - Git commit hash
 * @property {boolean} [override] - Whether an override was applied
 */

/**
 * Log an audit entry to the repo's audit log.
 *
 * @param {string} repoRoot
 * @param {Object} entry - Partial audit entry (timestamp and developer auto-populated)
 * @param {string} [logPath] - Override log path
 */
function log(repoRoot, entry, logPath) {
  const fullPath = path.join(repoRoot, logPath || DEFAULT_LOG_PATH);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const full = {
    timestamp: new Date().toISOString(),
    developer: getIdentity(repoRoot),
    branch: getBranch(repoRoot),
    commit: getCommit(repoRoot),
    override: false,
    ...entry,
  };

  fs.appendFileSync(fullPath, JSON.stringify(full) + '\n');
}

/**
 * Read all audit entries from the log.
 *
 * @param {string} repoRoot
 * @param {string} [logPath]
 * @returns {AuditEntry[]}
 */
function readLog(repoRoot, logPath) {
  const fullPath = path.join(repoRoot, logPath || DEFAULT_LOG_PATH);

  if (!fs.existsSync(fullPath)) return [];

  const content = fs.readFileSync(fullPath, 'utf8').trim();
  if (!content) return [];

  return content.split('\n').map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Log a pre-commit check result.
 */
function logPreCommit(repoRoot, { tool, result, severity, finding, logPath }) {
  log(repoRoot, {
    event: 'pre-commit',
    tool,
    result,
    severity,
    finding,
  }, logPath);
}

/**
 * Log an override event.
 */
function logOverride(repoRoot, { rule, reason, developer, expiresAt, logPath }) {
  log(repoRoot, {
    event: 'override',
    tool: rule,
    result: 'override',
    finding: reason,
    override: true,
    expiresAt,
  }, logPath);
}

function getIdentity(repoRoot) {
  try {
    return execSync('git config user.email', { cwd: repoRoot, stdio: 'pipe' }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function getBranch(repoRoot) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, stdio: 'pipe' }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function getCommit(repoRoot) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoRoot, stdio: 'pipe' }).toString().trim();
  } catch {
    return 'unknown';
  }
}

module.exports = {
  log,
  readLog,
  logPreCommit,
  logOverride,
  DEFAULT_LOG_PATH,
};
