/**
 * devflow fix
 *
 * Automatic remediation for findings.
 */

'use strict';

const { fix, canAutoFix, FIX_STRATEGIES } = require('../../core/fix');

function fixCommand(repoRoot, options = {}) {
  if (options.list) {
    console.log('devflow fix: Available auto-fix strategies\n');
    for (const [tool, strategy] of Object.entries(FIX_STRATEGIES)) {
      const status = strategy.canFix ? '✓ auto-fix' : '→ suggestion only';
      console.log(`  ${tool}: ${status} — ${strategy.description}`);
    }
    return;
  }

  console.log('devflow: Running auto-fix...\n');

  const results = fix(repoRoot, {
    tool: options.tool,
    scope: options.scope,
  });

  let fixed = 0;
  let failed = 0;

  for (const result of results) {
    if (result.fixed) {
      fixed++;
      console.log(`  ✓ ${result.tool} — ${result.action}`);
    } else if (result.error) {
      failed++;
      console.log(`  ✗ ${result.tool} — ${result.error}`);
    } else {
      console.log(`  → ${result.tool} — ${result.action}`);
    }
  }

  console.log(`\n${fixed} fixed, ${failed} failed, ${results.length - fixed - failed} manual`);
}

module.exports = fixCommand;
