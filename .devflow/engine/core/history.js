/**
 * Findings History
 *
 * Append-only record of every devflow check run per project.
 * Tracks when findings appeared, when they were fixed, and
 * progress over time.
 *
 * .devflow/history.json — one entry per check run.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HISTORY_PATH = '.devflow/history.json';

/**
 * @typedef {Object} HistoryEntry
 * @property {string} timestamp - ISO timestamp
 * @property {string} trigger - "pre-commit" | "check" | "ci"
 * @property {Object} summary
 * @property {number} summary.total
 * @property {number} summary.passed
 * @property {number} summary.failed
 * @property {number} summary.warnings
 * @property {number} summary.skipped
 * @property {number} summary.overridden
 * @property {string[]} findings - Finding IDs that were active (failed + warning)
 * @property {string[]} passed - Finding IDs that passed
 */

/**
 * Append a check run to history.
 *
 * @param {string} repoRoot
 * @param {Object} options
 * @param {string} options.trigger - What triggered this run
 * @param {Object} options.summary - Pass/fail/warn counts
 * @param {Array} options.findings - Full findings array from the check run
 */
function appendHistory(repoRoot, { trigger, summary, findings }) {
  const history = loadHistory(repoRoot);

  const entry = {
    timestamp: new Date().toISOString(),
    trigger,
    summary,
    findings: findings
      .filter(f => f.status === 'failed' || f.status === 'warning')
      .map(f => formatFindingId(f)),
    passed: findings
      .filter(f => f.status === 'passed')
      .map(f => formatFindingId(f)),
  };

  history.push(entry);

  const historyPath = path.join(repoRoot, HISTORY_PATH);
  const dir = path.dirname(historyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
}

/**
 * Load full history.
 *
 * @param {string} repoRoot
 * @returns {HistoryEntry[]}
 */
function loadHistory(repoRoot) {
  const historyPath = path.join(repoRoot, HISTORY_PATH);
  if (!fs.existsSync(historyPath)) return [];

  try {
    return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Get progress summary — compares first and latest run.
 *
 * @param {string} repoRoot
 * @returns {Object|null}
 */
function getProgress(repoRoot) {
  const history = loadHistory(repoRoot);
  if (history.length === 0) return null;

  const first = history[0];
  const latest = history[history.length - 1];

  // Find all unique findings that ever appeared
  const allFindings = new Set();
  for (const entry of history) {
    for (const f of entry.findings) allFindings.add(f);
  }

  // Find which are resolved (in first or any run, not in latest)
  const resolved = [];
  const remaining = [];
  for (const f of allFindings) {
    if (latest.findings.includes(f)) {
      remaining.push(f);
    } else {
      resolved.push(f);
    }
  }

  // Find new findings (in latest but not in first)
  const newFindings = latest.findings.filter(f => !first.findings.includes(f));

  return {
    firstRun: first.timestamp,
    latestRun: latest.timestamp,
    totalRuns: history.length,
    totalEverFound: allFindings.size,
    resolved: resolved.length,
    remaining: remaining.length,
    newSinceBaseline: newFindings.length,
    resolvedList: resolved,
    remainingList: remaining,
    newList: newFindings,
    trend: history.map(h => ({
      timestamp: h.timestamp,
      findings: h.findings.length,
      passed: h.passed.length,
    })),
  };
}

/**
 * Get the history of a specific finding — when it appeared and disappeared.
 *
 * @param {string} repoRoot
 * @param {string} findingId
 * @returns {Object}
 */
function getFindingHistory(repoRoot, findingId) {
  const history = loadHistory(repoRoot);
  const appearances = [];

  for (const entry of history) {
    appearances.push({
      timestamp: entry.timestamp,
      present: entry.findings.includes(findingId),
    });
  }

  const firstSeen = appearances.find(a => a.present);
  const lastSeen = [...appearances].reverse().find(a => a.present);
  const resolved = appearances.length > 0 && !appearances[appearances.length - 1].present;

  return {
    findingId,
    firstSeen: firstSeen ? firstSeen.timestamp : null,
    lastSeen: lastSeen ? lastSeen.timestamp : null,
    resolved,
    appearances,
  };
}

/**
 * Create a stable finding ID from a finding object.
 * Uses tool + hookId + file (if available) for stability across runs.
 */
function formatFindingId(finding) {
  const parts = [finding.tool, finding.hookId];
  if (finding.file) parts.push(finding.file);
  if (finding.line) parts.push(finding.line);
  return parts.join(':');
}

module.exports = {
  appendHistory,
  loadHistory,
  getProgress,
  getFindingHistory,
  HISTORY_PATH,
};
