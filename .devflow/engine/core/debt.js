/**
 * Technical Debt Management
 *
 * From spec section 8: Baseline on init. Enforce on new code only.
 * Progressive clean-up as files are touched.
 *
 * Phase 2: Automated weekly debt PR — devflow opens PRs fixing
 * highest-frequency debt issues. Debt reduction becomes a workflow,
 * not a report nobody acts on.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEBT_REPORT_PATH = '.devflow/debt-report.json';
const DEBT_REPORT_MD = '.devflow/debt-report.md';

/**
 * @typedef {Object} DebtFinding
 * @property {string} file - File path
 * @property {string} rule - Rule ID
 * @property {string} severity - Finding severity
 * @property {string} tool - Tool that found it
 * @property {string} description - Finding description
 * @property {string} baselinedAt - ISO timestamp when baselined
 * @property {boolean} cleared - Whether the finding has been resolved
 * @property {string} [clearedAt] - ISO timestamp when cleared
 */

/**
 * Create a baseline debt report for existing code.
 * Called during `devflow init` on repos with existing issues.
 *
 * @param {string} repoRoot
 * @param {DebtFinding[]} findings
 */
function baselineDebt(repoRoot, findings) {
  const now = new Date().toISOString();
  const baselined = findings.map(f => ({
    ...f,
    baselinedAt: now,
    cleared: false,
  }));

  const reportPath = path.join(repoRoot, DEBT_REPORT_PATH);
  const dir = path.dirname(reportPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(reportPath, JSON.stringify(baselined, null, 2) + '\n');
  generateMarkdownReport(repoRoot, baselined);
}

/**
 * Load the current debt report.
 *
 * @param {string} repoRoot
 * @returns {DebtFinding[]}
 */
function loadDebt(repoRoot) {
  const reportPath = path.join(repoRoot, DEBT_REPORT_PATH);
  if (!fs.existsSync(reportPath)) return [];

  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Mark findings as cleared when a file is cleaned up.
 *
 * @param {string} repoRoot
 * @param {string} file - File that was cleaned
 * @param {string[]} [rules] - Specific rules cleared (all if omitted)
 */
function clearFindings(repoRoot, file, rules) {
  const findings = loadDebt(repoRoot);
  const now = new Date().toISOString();
  let changed = false;

  for (const finding of findings) {
    if (finding.file !== file || finding.cleared) continue;
    if (rules && !rules.includes(finding.rule)) continue;
    finding.cleared = true;
    finding.clearedAt = now;
    changed = true;
  }

  if (changed) {
    const reportPath = path.join(repoRoot, DEBT_REPORT_PATH);
    fs.writeFileSync(reportPath, JSON.stringify(findings, null, 2) + '\n');
    generateMarkdownReport(repoRoot, findings);
  }
}

/**
 * Get debt summary statistics.
 *
 * @param {string} repoRoot
 * @returns {Object}
 */
function getDebtSummary(repoRoot) {
  const findings = loadDebt(repoRoot);
  const total = findings.length;
  const cleared = findings.filter(f => f.cleared).length;
  const remaining = total - cleared;

  // Group by file
  const byFile = {};
  for (const f of findings.filter(f => !f.cleared)) {
    byFile[f.file] = (byFile[f.file] || 0) + 1;
  }
  const topFiles = Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Check for 30-day escalations
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const escalated = findings.filter(f =>
    !f.cleared && new Date(f.baselinedAt) < thirtyDaysAgo
  );

  return { total, cleared, remaining, topFiles, escalated: escalated.length };
}

/**
 * Get findings that should escalate from warn to block (30-day rule).
 * From spec section 21.4: warnings in debt report for 30+ days escalate.
 *
 * @param {string} repoRoot
 * @returns {DebtFinding[]}
 */
function getEscalatedFindings(repoRoot) {
  const findings = loadDebt(repoRoot);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  return findings.filter(f =>
    !f.cleared &&
    f.severity === 'warn' &&
    new Date(f.baselinedAt) < thirtyDaysAgo
  );
}

/**
 * Generate markdown debt report.
 */
function generateMarkdownReport(repoRoot, findings) {
  const total = findings.length;
  const cleared = findings.filter(f => f.cleared).length;
  const remaining = total - cleared;
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0;

  const lines = [
    `# devflow Debt Report`,
    ``,
    `Generated: ${new Date().toISOString().split('T')[0]}`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total findings at init | ${total} |`,
    `| Cleared | ${cleared} (${pct}%) |`,
    `| Remaining | ${remaining} |`,
    ``,
  ];

  // Top files
  const byFile = {};
  for (const f of findings.filter(f => !f.cleared)) {
    byFile[f.file] = (byFile[f.file] || 0) + 1;
  }
  const topFiles = Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (topFiles.length > 0) {
    lines.push(`## Top files by finding count`);
    for (const [file, count] of topFiles) {
      lines.push(`- \`${file}\` — ${count} findings`);
    }
    lines.push('');
  }

  const mdPath = path.join(repoRoot, DEBT_REPORT_MD);
  fs.writeFileSync(mdPath, lines.join('\n'));
}

module.exports = {
  baselineDebt,
  loadDebt,
  clearFindings,
  getDebtSummary,
  getEscalatedFindings,
  DEBT_REPORT_PATH,
  DEBT_REPORT_MD,
};
