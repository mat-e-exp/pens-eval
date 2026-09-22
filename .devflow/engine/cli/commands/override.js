/**
 * devflow override
 *
 * Document a bypass for a failing check.
 * From spec section 16.2: logs override with identity, reason, expiry.
 */

'use strict';

const { createOverride, listOverrides, getActiveOverrides, processExpired } = require('../../core/overrides');
const { logOverride } = require('../../core/audit');

function override(repoRoot, options = {}) {
  // List mode
  if (options.list) {
    return listMode(repoRoot, options);
  }

  // Expire check mode
  if (options.processExpired) {
    return expireMode(repoRoot);
  }

  // Create mode
  if (!options.rule) {
    console.error('devflow override: --rule is required');
    console.log('\nUsage:');
    console.log('  devflow override --rule <rule-id> --reason "documented reason"');
    console.log('  devflow override --list');
    console.log('  devflow override --process-expired');
    console.log('\nOptions:');
    console.log('  --rule <id>          Rule to override');
    console.log('  --reason <text>      Documented reason (minimum 10 characters)');
    console.log('  --expiry <days>      Days until expiry (max 30, default 30)');
    console.log('  --file <path>        Specific file (default: all files)');
    console.log('  --list               List all overrides');
    console.log('  --process-expired    Process and flag expired overrides');
    process.exit(1);
  }

  if (!options.reason) {
    console.error('devflow override: --reason is required');
    process.exit(1);
  }

  const result = createOverride(repoRoot, {
    rule: options.rule,
    reason: options.reason,
    expiryDays: options.expiry || 30,
    file: options.file || '*',
  });

  // Log to audit
  logOverride(repoRoot, {
    rule: result.rule,
    reason: result.reason,
    developer: result.developer,
    expiresAt: result.expiresAt,
  });

  console.log('devflow: Override created\n');
  console.log(`  ID:        ${result.id}`);
  console.log(`  Rule:      ${result.rule}`);
  console.log(`  Reason:    ${result.reason}`);
  console.log(`  Developer: ${result.developer}`);
  console.log(`  Expires:   ${result.expiresAt}`);
  console.log(`  File:      ${result.file}`);
  console.log('\n  Founder will be notified. Override logged to audit trail.\n');
}

function listMode(repoRoot, options) {
  const overrides = options.activeOnly ? getActiveOverrides(repoRoot) : listOverrides(repoRoot);

  if (overrides.length === 0) {
    console.log('devflow: No overrides found.');
    return;
  }

  console.log(`devflow: ${overrides.length} override(s)\n`);

  for (const o of overrides) {
    const expired = new Date(o.expiresAt) <= new Date();
    const status = expired ? 'EXPIRED' : o.status.toUpperCase();
    console.log(`  [${status}] ${o.rule}`);
    console.log(`    Reason:    ${o.reason}`);
    console.log(`    Developer: ${o.developer}`);
    console.log(`    Expires:   ${o.expiresAt}`);
    if (o.approvedBy) {
      console.log(`    Approved:  ${o.approvedBy}`);
    }
    console.log('');
  }
}

function expireMode(repoRoot) {
  const expired = processExpired(repoRoot);

  if (expired.length === 0) {
    console.log('devflow: No overrides expired.');
    return;
  }

  console.log(`devflow: ${expired.length} override(s) expired\n`);
  for (const o of expired) {
    console.log(`  ${o.rule} — ${o.reason}`);
    console.log(`    Developer: ${o.developer}`);
    console.log(`    Gate re-activated.`);
    console.log('');
  }
}

module.exports = override;
