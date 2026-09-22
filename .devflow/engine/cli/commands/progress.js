/**
 * devflow progress
 *
 * Show findings history and resolution progress for a project.
 */

'use strict';

const { getProgress, loadHistory } = require('../../core/history');

function progress(repoRoot) {
  const data = getProgress(repoRoot);

  if (!data) {
    console.log('devflow: No history found. Run devflow check first.');
    return;
  }

  console.log('devflow: Findings Progress\n');

  console.log(`  First scan:  ${data.firstRun.split('T')[0]}`);
  console.log(`  Latest scan: ${data.latestRun.split('T')[0]}`);
  console.log(`  Total runs:  ${data.totalRuns}`);
  console.log('');

  console.log(`  Total findings ever: ${data.totalEverFound}`);
  console.log(`  Resolved:           ${data.resolved}`);
  console.log(`  Remaining:          ${data.remaining}`);
  console.log(`  New since baseline: ${data.newSinceBaseline}`);

  if (data.totalEverFound > 0) {
    const pct = Math.round((data.resolved / data.totalEverFound) * 100);
    console.log(`\n  Progress: ${pct}% resolved`);
  }

  if (data.resolvedList.length > 0) {
    console.log('\n  Resolved:');
    for (const f of data.resolvedList) {
      console.log(`    ✓ ${f}`);
    }
  }

  if (data.remainingList.length > 0) {
    console.log('\n  Remaining:');
    for (const f of data.remainingList) {
      console.log(`    ✗ ${f}`);
    }
  }

  if (data.trend.length > 1) {
    console.log('\n  Trend:');
    for (const t of data.trend) {
      const date = t.timestamp.split('T')[0];
      const time = t.timestamp.split('T')[1].split('.')[0];
      console.log(`    ${date} ${time} — ${t.findings} findings, ${t.passed} passed`);
    }
  }

  console.log('');
}

module.exports = progress;
