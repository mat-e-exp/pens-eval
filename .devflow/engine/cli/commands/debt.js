/**
 * devflow debt
 *
 * Show technical debt report.
 * From spec section 8: baseline on init, enforce on new code only.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function debt(repoRoot) {
  const debtPath = path.join(repoRoot, '.devflow', 'debt-report.md');

  if (!fs.existsSync(debtPath)) {
    console.log('devflow: No debt report found. Run devflow init to baseline.');
    return;
  }

  const content = fs.readFileSync(debtPath, 'utf8');
  console.log(content);
}

module.exports = debt;
