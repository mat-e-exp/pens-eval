/**
 * Module Interface
 *
 * Defines the contract for devflow modules — language tools, security
 * scanners, quality gates, and external integrations.
 *
 * From spec section 4.1: A new language/tool is a single module file.
 * The core does not change. The module declares detection, lint tool,
 * security tool, pre-commit hook, and CI job.
 *
 * @typedef {Object} ModuleDefinition
 * @property {string} id - Unique module identifier
 * @property {string} name - Human-readable name
 * @property {string} type - "language" | "security" | "quality-gate" | "integration"
 * @property {string} version - Semver version
 * @property {boolean} optional - Whether this module is opt-in (not enabled by default)
 *
 * @property {function(string): boolean} [detect] - Detect if module applies to repo (given repo root)
 * @property {PreCommitHook[]} [preCommitHooks] - Hooks this module contributes
 * @property {CIJob[]} [ciJobs] - CI jobs this module contributes
 * @property {function(EnforcementPlan): EnforcementPlan} [extendPlan] - Modify the enforcement plan
 *
 * @property {Object} [config] - Module-specific default configuration
 * @property {string} [checksum] - Integrity checksum for community modules
 */

'use strict';

const VALID_MODULE_TYPES = ['language', 'security', 'quality-gate', 'integration'];

/**
 * Validate a module conforms to the interface.
 *
 * @param {ModuleDefinition} mod
 * @throws {Error} if module is invalid
 */
function validateModule(mod) {
  const errors = [];

  if (!mod.id || typeof mod.id !== 'string') {
    errors.push('Module must have a string id');
  }
  if (!mod.name || typeof mod.name !== 'string') {
    errors.push('Module must have a string name');
  }
  if (!VALID_MODULE_TYPES.includes(mod.type)) {
    errors.push(`Invalid module type: ${mod.type}. Valid: ${VALID_MODULE_TYPES.join(', ')}`);
  }
  if (!mod.version || typeof mod.version !== 'string') {
    errors.push('Module must have a string version');
  }

  // At least one contribution method must be defined
  const hasContribution = mod.detect || mod.preCommitHooks || mod.ciJobs || mod.extendPlan;
  if (!hasContribution) {
    errors.push('Module must define at least one of: detect, preCommitHooks, ciJobs, extendPlan');
  }

  if (mod.detect && typeof mod.detect !== 'function') {
    errors.push('detect must be a function');
  }
  if (mod.preCommitHooks && !Array.isArray(mod.preCommitHooks)) {
    errors.push('preCommitHooks must be an array');
  }
  if (mod.ciJobs && !Array.isArray(mod.ciJobs)) {
    errors.push('ciJobs must be an array');
  }
  if (mod.extendPlan && typeof mod.extendPlan !== 'function') {
    errors.push('extendPlan must be a function');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid module "${mod.id || 'unknown'}":\n  ${errors.join('\n  ')}`);
  }
}

module.exports = {
  validateModule,
  VALID_MODULE_TYPES,
};
