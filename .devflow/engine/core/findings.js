/**
 * Findings Store
 *
 * Per-project .devflow/findings.json — structured, machine-readable
 * record of the last devflow check run. AI tools can read this to
 * understand what needs fixing and provide targeted guidance.
 *
 * Updated on every `devflow check`. Current-state snapshot, not append-only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { GUIDANCE } = require('./fix-guidance');
const { getActiveOverrides } = require('./overrides');

const FINDINGS_PATH = '.devflow/findings.json';

/**
 * @typedef {Object} Finding
 * @property {string} id - Unique finding identifier
 * @property {string} tool - Tool that found it
 * @property {string} hookId - Hook/job ID that produced it
 * @property {string} severity - "critical" | "high" | "medium" | "low"
 * @property {string} status - "failed" | "warning" | "passed" | "skipped" | "overridden"
 * @property {string} failPolicy - "closed" | "open" | "open-notify"
 * @property {string} [file] - File path where issue was found
 * @property {string} [line] - Line number or range
 * @property {string} description - What was found
 * @property {string[]} fixSteps - How to fix it
 * @property {string} [docsUrl] - Documentation link
 * @property {string} [rawOutput] - Raw tool output for context
 * @property {Object} [override] - Active override if one exists
 */

/**
 * @typedef {Object} FindingsReport
 * @property {string} timestamp - ISO timestamp of last scan
 * @property {string} repoRoot - Repository root path
 * @property {Object} summary
 * @property {number} summary.total - Total checks run
 * @property {number} summary.passed - Checks that passed
 * @property {number} summary.failed - Checks that failed (blocking)
 * @property {number} summary.warnings - Checks that warned (non-blocking)
 * @property {number} summary.skipped - Checks skipped (tool not installed)
 * @property {number} summary.overridden - Checks with active overrides
 * @property {Finding[]} findings - All findings
 */

/**
 * Record a check result as a finding.
 *
 * @param {Object} hook - The hook/job that ran
 * @param {Object} result - Run result
 * @param {string} status - "passed" | "failed" | "warning" | "skipped"
 * @returns {Finding}
 */
function createFinding(hook, result, status) {
  const guidance = GUIDANCE[hook.tool] || GUIDANCE[hook.id];
  const combined = ((result && result.output) || '') + '\n' + ((result && result.error) || '');

  // Parse file/line from tool output
  const { file, line, description } = parseLocation(hook, combined);

  return {
    id: `${hook.id}-${Date.now()}`,
    tool: hook.tool,
    hookId: hook.id,
    severity: hook.severity || (hook.failPolicy === 'closed' ? 'high' : 'medium'),
    status,
    failPolicy: hook.failPolicy,
    file: file || null,
    line: line || null,
    description: description || (guidance ? guidance.title : `${hook.tool} check ${status}`),
    fixSteps: guidance ? guidance.fixSteps : ['Review the output and fix the issue'],
    docsUrl: guidance ? guidance.docs : null,
    rawOutput: combined.trim().slice(0, 2000) || null,
    override: null,
  };
}

/**
 * Save findings report to .devflow/findings.json.
 *
 * @param {string} repoRoot
 * @param {Finding[]} findings
 */
function saveFindings(repoRoot, findings) {
  // Check for active overrides and mark findings
  const overrides = getActiveOverrides(repoRoot);
  for (const finding of findings) {
    const override = overrides.find(o =>
      o.rule === finding.tool || o.rule === finding.hookId
    );
    if (override) {
      finding.override = {
        id: override.id,
        reason: override.reason,
        expiresAt: override.expiresAt,
        developer: override.developer,
      };
      if (finding.status === 'failed') {
        finding.status = 'overridden';
      }
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    repoRoot,
    summary: {
      total: findings.length,
      passed: findings.filter(f => f.status === 'passed').length,
      failed: findings.filter(f => f.status === 'failed').length,
      warnings: findings.filter(f => f.status === 'warning').length,
      skipped: findings.filter(f => f.status === 'skipped').length,
      overridden: findings.filter(f => f.status === 'overridden').length,
    },
    findings,
  };

  const findingsPath = path.join(repoRoot, FINDINGS_PATH);
  const dir = path.dirname(findingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(findingsPath, JSON.stringify(report, null, 2) + '\n');
  return report;
}

/**
 * Load findings report from .devflow/findings.json.
 *
 * @param {string} repoRoot
 * @returns {FindingsReport|null}
 */
function loadFindings(repoRoot) {
  const findingsPath = path.join(repoRoot, FINDINGS_PATH);
  if (!fs.existsSync(findingsPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Parse file/line/description from tool output.
 */
function parseLocation(hook, output) {
  const result = { file: null, line: null, description: null };

  // Trivy: "key.pem:2-27" or "HIGH: AsymmetricPrivateKey"
  const trivyFile = output.match(/^\s+(\S+):(\d+[-–]\d+)/m);
  if (trivyFile) {
    result.file = trivyFile[1];
    result.line = trivyFile[2];
  }
  const trivySeverity = output.match(/^(CRITICAL|HIGH|MEDIUM|LOW):\s+(.+)/m);
  if (trivySeverity) {
    result.description = `${trivySeverity[1]}: ${trivySeverity[2]}`;
  }

  // Semgrep: "path/file.py:10: error: [rule-id] message"
  const semgrepMatch = output.match(/^(\S+):(\d+):\s+(?:error|warning):\s+(.+)/m);
  if (semgrepMatch) {
    result.file = semgrepMatch[1];
    result.line = semgrepMatch[2];
    result.description = semgrepMatch[3];
  }

  // ESLint: "path/file.js:10:5: error message"
  const eslintMatch = output.match(/^(\S+):(\d+):\d+:\s+(.+)/m);
  if (eslintMatch) {
    result.file = eslintMatch[1];
    result.line = eslintMatch[2];
    result.description = eslintMatch[3];
  }

  // CVE: "CVE-2024-1234 in package@version"
  const cveMatch = output.match(/(CVE-\d{4}-\d+)\s+(?:in\s+)?(\S+)/);
  if (cveMatch) {
    result.description = `${cveMatch[1]} in ${cveMatch[2]}`;
  }

  return result;
}

module.exports = {
  createFinding,
  saveFindings,
  loadFindings,
  FINDINGS_PATH,
};
