/**
 * Fail Policy
 *
 * From spec section 17. Determines whether a tool failure blocks the
 * pipeline (closed), allows it to continue (open), or allows with
 * immediate notification (open-notify).
 *
 * Secrets always fail closed. Everything else fails open with notification.
 * Fail open never means invisible — every failure is logged.
 */

'use strict';

const { DEFAULT_FAIL_POLICY, VALID_FAIL_POLICIES } = require('../core/enforcement-plan');

/**
 * Resolve the fail policy for a given tool.
 *
 * @param {string} toolId - Tool identifier
 * @param {Object.<string, string>} [overrides] - Per-repo overrides
 * @returns {string} "closed" | "open" | "open-notify"
 */
function resolvePolicy(toolId, overrides = {}) {
  const policy = overrides[toolId] || DEFAULT_FAIL_POLICY[toolId] || 'open-notify';

  if (!VALID_FAIL_POLICIES.includes(policy)) {
    throw new Error(`Invalid fail policy "${policy}" for tool "${toolId}". Valid: ${VALID_FAIL_POLICIES.join(', ')}`);
  }

  return policy;
}

/**
 * Check if a tool failure should block the pipeline.
 *
 * @param {string} toolId
 * @param {Object.<string, string>} [overrides]
 * @returns {boolean}
 */
function shouldBlock(toolId, overrides = {}) {
  return resolvePolicy(toolId, overrides) === 'closed';
}

/**
 * Check if a tool failure should trigger immediate notification.
 *
 * @param {string} toolId
 * @param {Object.<string, string>} [overrides]
 * @returns {boolean}
 */
function shouldNotify(toolId, overrides = {}) {
  const policy = resolvePolicy(toolId, overrides);
  return policy === 'closed' || policy === 'open-notify';
}

module.exports = {
  resolvePolicy,
  shouldBlock,
  shouldNotify,
};
