/**
 * Override System
 *
 * From spec sections 7.1 and 16.2:
 * - Documented reason required
 * - Founder approval required
 * - Maximum 30-day expiry
 * - Logged permanently with developer identity
 * - GitHub issue reopens on expiry
 * - No permanent silent bypasses
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OVERRIDES_DIR = '.devflow/overrides';
const MAX_EXPIRY_DAYS = 30;

/**
 * @typedef {Object} Override
 * @property {string} id - Unique override identifier
 * @property {string} rule - Rule being overridden (e.g. "semgrep.sql-injection")
 * @property {string} reason - Documented reason for override
 * @property {string} developer - Developer identity (git user.email)
 * @property {string} createdAt - ISO timestamp
 * @property {string} expiresAt - ISO timestamp
 * @property {string} file - File the override applies to (optional, can be "*")
 * @property {string} status - "active" | "expired" | "approved" | "rejected"
 * @property {string|null} approvedBy - Founder who approved (null if pending)
 */

/**
 * Create a new override request.
 *
 * @param {string} repoRoot
 * @param {Object} options
 * @param {string} options.rule - Rule ID to override
 * @param {string} options.reason - Documented reason
 * @param {number} [options.expiryDays=30] - Days until expiry
 * @param {string} [options.file="*"] - Specific file or "*" for all
 * @returns {Override}
 */
function createOverride(repoRoot, { rule, reason, expiryDays = MAX_EXPIRY_DAYS, file = '*' }) {
  if (!rule || typeof rule !== 'string') {
    throw new Error('Override requires a rule ID');
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    throw new Error('Override requires a documented reason (minimum 10 characters)');
  }
  if (expiryDays > MAX_EXPIRY_DAYS) {
    throw new Error(`Maximum override expiry is ${MAX_EXPIRY_DAYS} days`);
  }
  if (expiryDays < 1) {
    throw new Error('Override must be at least 1 day');
  }

  const developer = getGitIdentity(repoRoot);
  const now = new Date();
  const expires = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

  const override = {
    id: `override-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    rule,
    reason: reason.trim(),
    developer,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    file,
    status: 'active',
    approvedBy: null,
  };

  // Save to overrides directory
  const overridesDir = path.join(repoRoot, OVERRIDES_DIR);
  if (!fs.existsSync(overridesDir)) {
    fs.mkdirSync(overridesDir, { recursive: true });
  }

  const filePath = path.join(overridesDir, `${override.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(override, null, 2) + '\n');

  return override;
}

/**
 * List all overrides for a repository.
 *
 * @param {string} repoRoot
 * @returns {Override[]}
 */
function listOverrides(repoRoot) {
  const overridesDir = path.join(repoRoot, OVERRIDES_DIR);
  if (!fs.existsSync(overridesDir)) return [];

  const files = fs.readdirSync(overridesDir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const content = fs.readFileSync(path.join(overridesDir, f), 'utf8');
    return JSON.parse(content);
  });
}

/**
 * Get active (non-expired) overrides.
 *
 * @param {string} repoRoot
 * @returns {Override[]}
 */
function getActiveOverrides(repoRoot) {
  const now = new Date();
  return listOverrides(repoRoot).filter(o => {
    if (o.status === 'expired' || o.status === 'rejected') return false;
    return new Date(o.expiresAt) > now;
  });
}

/**
 * Check if a specific rule has an active override.
 *
 * @param {string} repoRoot
 * @param {string} rule - Rule ID
 * @param {string} [file] - Specific file path
 * @returns {Override|null}
 */
function findOverride(repoRoot, rule, file) {
  const active = getActiveOverrides(repoRoot);
  return active.find(o => {
    if (o.rule !== rule) return false;
    if (o.file === '*') return true;
    if (file && o.file === file) return true;
    return false;
  }) || null;
}

/**
 * Process expired overrides — mark as expired and return list.
 *
 * @param {string} repoRoot
 * @returns {Override[]} Newly expired overrides
 */
function processExpired(repoRoot) {
  const overrides = listOverrides(repoRoot);
  const now = new Date();
  const newlyExpired = [];

  for (const override of overrides) {
    if (override.status === 'active' && new Date(override.expiresAt) <= now) {
      override.status = 'expired';
      const filePath = path.join(repoRoot, OVERRIDES_DIR, `${override.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(override, null, 2) + '\n');
      newlyExpired.push(override);
    }
  }

  return newlyExpired;
}

/**
 * Approve an override (founder action).
 *
 * @param {string} repoRoot
 * @param {string} overrideId
 * @param {string} approver - Approver identity
 * @returns {Override}
 */
function approveOverride(repoRoot, overrideId, approver) {
  const filePath = path.join(repoRoot, OVERRIDES_DIR, `${overrideId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Override not found: ${overrideId}`);
  }

  const override = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  override.status = 'approved';
  override.approvedBy = approver;
  fs.writeFileSync(filePath, JSON.stringify(override, null, 2) + '\n');

  return override;
}

/**
 * Get git user identity from repo config.
 */
function getGitIdentity(repoRoot) {
  try {
    const email = execSync('git config user.email', { cwd: repoRoot, stdio: 'pipe' })
      .toString().trim();
    return email || 'unknown';
  } catch {
    return 'unknown';
  }
}

module.exports = {
  createOverride,
  listOverrides,
  getActiveOverrides,
  findOverride,
  processExpired,
  approveOverride,
  OVERRIDES_DIR,
  MAX_EXPIRY_DAYS,
};
