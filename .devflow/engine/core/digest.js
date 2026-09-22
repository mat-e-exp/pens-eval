/**
 * Weekly Digest
 *
 * From spec section 9.1: A GitHub Actions summary emails the founder
 * weekly with: what fired most, what was overridden, what passed,
 * which files have the most findings.
 *
 * This is the feedback loop that drives rule tuning before noise
 * becomes a bypass culture.
 */

'use strict';

const { readLog } = require('./audit');
const { listOverrides } = require('./overrides');

/**
 * Generate a weekly digest from audit log and override data.
 *
 * @param {string} repoRoot
 * @param {Object} [options]
 * @param {number} [options.days=7] - Number of days to cover
 * @param {string} [options.logPath] - Override audit log path
 * @returns {Object} Digest data
 */
function generateDigest(repoRoot, options = {}) {
  const days = options.days || 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const entries = readLog(repoRoot, options.logPath)
    .filter(e => new Date(e.timestamp) >= cutoff);

  const overrides = listOverrides(repoRoot)
    .filter(o => new Date(o.createdAt) >= cutoff);

  // Aggregate stats
  const totalChecks = entries.length;
  const passed = entries.filter(e => e.result === 'passed').length;
  const failed = entries.filter(e => e.result === 'failed').length;
  const warnings = entries.filter(e => e.result === 'warning').length;

  // Most fired tools
  const toolCounts = {};
  for (const entry of entries.filter(e => e.result === 'failed')) {
    toolCounts[entry.tool] = (toolCounts[entry.tool] || 0) + 1;
  }
  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Most problematic files
  const fileCounts = {};
  for (const entry of entries.filter(e => e.result === 'failed' && e.file)) {
    fileCounts[entry.file] = (fileCounts[entry.file] || 0) + 1;
  }
  const topFiles = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Override summary
  const activeOverrides = overrides.filter(o => o.status === 'active' || o.status === 'approved');
  const expiredOverrides = overrides.filter(o => o.status === 'expired');

  return {
    period: { from: cutoff.toISOString(), to: new Date().toISOString(), days },
    summary: { totalChecks, passed, failed, warnings },
    topTools,
    topFiles,
    overrides: {
      created: overrides.length,
      active: activeOverrides.length,
      expired: expiredOverrides.length,
    },
  };
}

/**
 * Format digest as markdown for email/notification.
 *
 * @param {Object} digest
 * @returns {string}
 */
function formatDigestMarkdown(digest) {
  const lines = [
    `# devflow Weekly Digest`,
    ``,
    `**Period:** ${digest.period.from.split('T')[0]} to ${digest.period.to.split('T')[0]}`,
    ``,
    `## Summary`,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total checks | ${digest.summary.totalChecks} |`,
    `| Passed | ${digest.summary.passed} |`,
    `| Failed | ${digest.summary.failed} |`,
    `| Warnings | ${digest.summary.warnings} |`,
    ``,
  ];

  if (digest.topTools.length > 0) {
    lines.push(`## Most Fired Tools`);
    for (const [tool, count] of digest.topTools) {
      lines.push(`- **${tool}**: ${count} failures`);
    }
    lines.push('');
  }

  if (digest.topFiles.length > 0) {
    lines.push(`## Most Problematic Files`);
    for (const [file, count] of digest.topFiles) {
      lines.push(`- \`${file}\`: ${count} findings`);
    }
    lines.push('');
  }

  lines.push(`## Overrides`);
  lines.push(`- Created this period: ${digest.overrides.created}`);
  lines.push(`- Currently active: ${digest.overrides.active}`);
  lines.push(`- Expired this period: ${digest.overrides.expired}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format digest as JSON for API consumption.
 *
 * @param {Object} digest
 * @returns {string}
 */
function formatDigestJSON(digest) {
  return JSON.stringify(digest, null, 2);
}

module.exports = {
  generateDigest,
  formatDigestMarkdown,
  formatDigestJSON,
};
